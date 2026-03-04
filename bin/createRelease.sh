#!/bin/bash
#
# WARNING: since Etherpad 1.7.0 (2018-08-17), this script is DEPRECATED, and
#          will be removed/modified in a future version.
#          It's left here just for documentation.
#          The branching policies for releases have been changed.
#
# This script is used to publish a new release/version of etherpad on github
#
# Work that is done by this script:
# ETHER_REPO:
# - Add text to CHANGELOG.md
# - Replace version of etherpad in src/package.json
# - Create a release branch and push it to github
# - Merges this release branch into master branch
# - Creating the windows build and the docs
# ETHER_WEB_REPO:
# - Creating a new branch with the docs and the windows build
# - Replacing the version numbers in the index.html
# - Push this branch and merge it to master
# ETHER_REPO:
# - Create a new release on github

printf "WARNING: since Etherpad 1.7.0 this script is DEPRECATED, and will be removed/modified in a future version.\n\n"
while true; do
    read -p "Do you want to continue? This is discouraged. [y/N]" yn
    case $yn in
        [Yy]* ) break;;
        [Nn]* ) exit;;
        * ) printf "Please answer yes or no.\n\n";;
    esac
done

ETHER_REPO="https://github.com/ether/etherpad-lite.git"
ETHER_WEB_REPO="https://github.com/ether/ether.github.com.git"
TMP_DIR="/tmp/"

echo "WARNING: You can only run this script if your github api token is allowed to create and merge branches on $ETHER_REPO and $ETHER_WEB_REPO."
echo "This script automatically changes the version number in package.json and adds a text to CHANGELOG.md."
echo "When you use this script you should be in the branch that you want to release (develop probably) on latest version. Any changes that are currently not committed will be committed."
echo "-----"

# Get the latest version
LATEST_GIT_TAG=$(git tag | tail -n 1)

# Current environment
echo "Current environment: "
echo "- branch: $(git branch | grep '* ')"
echo "- last commit date: $(git show --quiet --pretty=format:%ad)"
echo "- current version: $LATEST_GIT_TAG"
echo "- temp dir: $TMP_DIR"

# Get new version number
# format: x.x.x
echo -n "Enter new version (x.x.x): "
read VERSION

# Get the message for the changelogs
read -p "Enter new changelog entries (press enter): "
tmp=$(mktemp)
"${EDITOR:-vi}" $tmp
changelogText=$(<$tmp)
echo "$changelogText"
rm $tmp

if [ "$changelogText" != "" ]; then
  changelogText="# $VERSION\n$changelogText"
fi

# get the token for the github api
echo -n "Enter your github api token: "
read API_TOKEN

function check_api_token {
  echo "Checking if github api token is valid..."
  CURL_RESPONSE=$(curl --silent -i https://api.github.com/user?access_token=$API_TOKEN | iconv -f utf8)
  HTTP_STATUS=$(echo $CURL_RESPONSE | head -1 | sed -r 's/.* ([0-9]{3}) .*/\1/')
  [[ $HTTP_STATUS != "200" ]] && echo "Aborting: Invalid github api token" && exit 1
}

function modify_files {
  # Add changelog text to first line of CHANGELOG.md

  msg=""
  # source: https://unix.stackexchange.com/questions/9784/how-can-i-read-line-by-line-from-a-variable-in-bash#9789
  while IFS= read -r line
  do
    # replace newlines with literal "\n" for using with sed
    msg+="$line\n"
  done < <(printf '%s\n' "${changelogText}")

  sed -i "1s/^/${msg}\n/" CHANGELOG.md
  [[ $? != 0 ]] && echo "Aborting: Error modifying CHANGELOG.md" && exit 1

  # Replace version number of etherpad in package.json
  sed -i -r "s/(\"version\"[ ]*: \").*(\")/\1$VERSION\2/" src/package.json
  [[ $? != 0 ]] && echo "Aborting: Error modifying package.json" && exit 1
}

function create_release_branch {
  echo "Creating new release branch..."
  git rev-parse --verify release/$VERSION 2>/dev/null
  if [ $? == 0 ]; then
    echo "Aborting: Release branch already present"
    exit 1
  fi
  git checkout -b release/$VERSION
  [[ $? != 0 ]] && echo "Aborting: Error creating release branch" && exit 1

  echo "Committing CHANGELOG.md and package.json"
  git add CHANGELOG.md
  git add src/package.json
  git commit -m "Release version $VERSION"

  echo "Pushing release branch to github..."
  git push -u $ETHER_REPO release/$VERSION
  [[ $? != 0 ]] && echo "Aborting: Error pushing release branch to github" && exit 1
}

function merge_release_branch {
  echo "Merging release to master branch on github..."
  API_JSON=$(printf '{"base": "master","head": "release/%s","commit_message": "Merge new release into master branch!"}' $VERSION)
  CURL_RESPONSE=$(curl --silent -i -N --data "$API_JSON" https://api.github.com/repos/ether/etherpad-lite/merges?access_token=$API_TOKEN  | iconv -f utf8)
  echo $CURL_RESPONSE
  HTTP_STATUS=$(echo $CURL_RESPONSE | head -1 | sed -r 's/.* ([0-9]{3}) .*/\1/')
  [[ $HTTP_STATUS != "200" ]] && echo "Aborting: Error merging release branch on github" && exit 1
}

function create_builds {
  echo "Cloning etherpad-lite repo and ether.github.com repo..."
  cd $TMP_DIR
  rm -rf etherpad-lite ether.github.com
  git clone $ETHER_REPO --branch master
  git clone $ETHER_WEB_REPO
  echo "Creating windows build..."
  cd etherpad-lite
  bin/buildForWindows.sh
  [[ $? != 0 ]] && echo "Aborting: Error creating build for windows" && exit 1
  echo "Creating docs..."
  make docs
  [[ $? != 0 ]] && echo "Aborting: Error generating docs" && exit 1
}

function push_builds {
  cd $TMP_DIR/etherpad-lite/
  echo "Copying windows build and docs to website repo..."
  GIT_SHA=$(git rev-parse HEAD | cut -c1-10)
  mv etherpad-win.zip $TMP_DIR/ether.github.com/downloads/etherpad-win-$VERSION-$GIT_SHA.zip

  mv out/doc $TMP_DIR/ether.github.com/doc/v$VERSION

  cd $TMP_DIR/ether.github.com/
  sed -i "s/etherpad-win.*\.zip/etherpad-win-$VERSION-$GIT_SHA.zip/" index.html
  sed -i "s/$LATEST_GIT_TAG/$VERSION/g" index.html
  git checkout -b release_$VERSION
  [[ $? != 0 ]] && echo "Aborting: Error creating new release branch" && exit 1
  git add doc/
  git add downloads/
  git commit -a -m "Release version $VERSION"
  git push -u $ETHER_WEB_REPO release_$VERSION
  [[ $? != 0 ]] && echo "Aborting: Error pushing release branch to github" && exit 1
}

function merge_web_branch {
        echo "Merging release to master branch on github..."
        API_JSON=$(printf '{"base": "master","head": "release_%s","commit_message": "Release version %s"}' $VERSION $VERSION)
         CURL_RESPONSE=$(curl --silent -i -N --data "$API_JSON" https://api.github.com/repos/ether/ether.github.com/merges?access_token=$API_TOKEN | iconv -f utf8)
  echo $CURL_RESPONSE
  HTTP_STATUS=$(echo $CURL_RESPONSE | head -1 | sed -r 's/.* ([0-9]{3}) .*/\1/')
  [[ $HTTP_STATUS != "200" ]] && echo "Aborting: Error merging release branch" && exit 1
}

function publish_release {
  echo -n "Do you want to publish a new release on github (y/n)? "
  read PUBLISH_RELEASE
  if [ $PUBLISH_RELEASE = "y" ]; then
    # create a new release on github
    API_JSON=$(printf '{"tag_name": "%s","target_commitish": "master","name": "Release %s","body": "%s","draft": false,"prerelease": false}' $VERSION $VERSION $changelogText)
    CURL_RESPONSE=$(curl --silent -i -N --data "$API_JSON" https://api.github.com/repos/ether/etherpad-lite/releases?access_token=$API_TOKEN | iconv -f utf8)
    HTTP_STATUS=$(echo $CURL_RESPONSE | head -1 | sed -r 's/.* ([0-9]{3}) .*/\1/')
    [[ $HTTP_STATUS != "201" ]] && echo "Aborting: Error publishing release on github" && exit 1
  else
    echo "No release published on github!"
  fi
}

function todo_notification {
  echo "Release procedure was successful, but you have to do some steps manually:"
  echo "- Update the wiki at https://github.com/ether/etherpad-lite/wiki"
  echo "- Create a pull request on github to merge the master branch back to develop"
  echo "- Announce the new release on the mailing list, blog.etherpad.org and Twitter"
}

# Call functions
check_api_token
modify_files
create_release_branch
merge_release_branch
create_builds
push_builds
merge_web_branch
publish_release
todo_notification
