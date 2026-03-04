import {readFileSync} from "node:fs";

const changelog = readFileSync('../CHANGELOG.md')
const changelogText = changelog.toString()
const changelogLines = changelogText.split('\n')


let cliArgs = process.argv.slice(2)

let tagVar = cliArgs[0]

if (!tagVar) {
  console.error("No tag provided")
  process.exit(1)
}

tagVar = tagVar.replace("refs/tags/v", "")

let startNum = -1
let endline = 0

let counter = 0
for (const line of changelogLines) {
    if (line.trim().startsWith("#") && (line.match(new RegExp("#", "g"))||[]).length === 1) {
      if (startNum !== -1) {
        endline = counter-1
        break
      }

      const sanitizedLine = line.replace("#","").trim()
      if(sanitizedLine.includes(tagVar)) {
        startNum = counter
      }
    }
    counter++
}

let currentReleaseNotes = changelogLines.slice(startNum, endline).join('\n')
console.log(currentReleaseNotes)
