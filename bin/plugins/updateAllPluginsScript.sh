cd node_modules
GHUSER=johnmclear; curl "https://api.github.com/users/$GHUSER/repos?per_page=1000" | grep -o 'git@[^"]*' | grep /ep_ | xargs -L1 git clone
GHUSER=johnmclear; curl "https://api.github.com/users/$GHUSER/repos?per_page=1000&page=2" | grep -o 'git@[^"]*' | grep /ep_ | xargs -L1 git clone
GHUSER=johnmclear; curl "https://api.github.com/users/$GHUSER/repos?per_page=1000&page=3" | grep -o 'git@[^"]*' | grep /ep_ | xargs -L1 git clone
GHUSER=johnmclear; curl "https://api.github.com/users/$GHUSER/repos?per_page=1000&page=4" | grep -o 'git@[^"]*' | grep /ep_ | xargs -L1 git clone
cd ..

for dir in `ls node_modules`;
do
  # echo $0
  if [[ $dir == *"ep_"* ]]; then
    if [[ $dir != "ep_etherpad-lite" ]]; then
      pnpm run checkPlugins $dir autopush
    fi
  fi
  # echo $dir
done
