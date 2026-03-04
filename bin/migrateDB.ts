// DB migration
import {readFileSync} from 'node:fs'
import {Database, DatabaseType} from "ueberdb2";
import path from "node:path";
import settings from 'ep_etherpad-lite/node/utils/Settings';


// file1 = source, file2 = target
// pnpm run --filter bin migrateDB --file1 <db1.json> --file2 <db2.json>
const arg = process.argv.slice(2);

if (arg.length != 4) {
  console.error('Wrong number of arguments!. Call with pnpm run --filter bin migrateDB --file1 source.json target.json')
  process.exit(1)
}

type SettingsConfig = {
  dbType: string,
  dbSettings: any
}

/*
  {
    "dbType": "<your-db-type>",
    "dbSettings": {
      <your-db-settings>
     }
  }
 */

let firstDBSettingsFile: string
let secondDBSettingsFile: string


if (arg[0] == "--file1") {
    firstDBSettingsFile = arg[1]
} else if (arg[0] === "--file2") {
  secondDBSettingsFile = arg[1]
}

if (arg[2] == "--file1") {
  firstDBSettingsFile = arg[3]
} else if (arg[2] === "--file2") {
  secondDBSettingsFile = arg[3]
}



const settingsfile = JSON.parse(readFileSync(path.join(settings.root,firstDBSettingsFile!)).toString()) as SettingsConfig
const settingsfile2 = JSON.parse(readFileSync(path.join(settings.root,secondDBSettingsFile!)).toString()) as SettingsConfig

console.log(settingsfile2)
if ("filename" in settingsfile.dbSettings) {
  settingsfile.dbSettings.filename = path.join(settings.root, settingsfile.dbSettings.filename)
  console.log(settingsfile.dbType + " location is "+ settingsfile.dbSettings.filename)
}

if ("filename" in settingsfile2.dbSettings) {
  settingsfile2.dbSettings.filename = path.join(settings.root, settingsfile2.dbSettings.filename)
  console.log(settingsfile2.dbType + " location is "+ settingsfile2.dbSettings.filename)
}

const ueberdb1 = new Database(settingsfile.dbType as DatabaseType, settingsfile.dbSettings)
const ueberdb2 = new Database(settingsfile2.dbType as DatabaseType, settingsfile2.dbSettings)

const handleSync = async ()=>{
  await ueberdb1.init()
  await ueberdb2.init()

  const allKeys = await ueberdb1.findKeys('*','')
  for (const key of allKeys) {
    const foundVal = await ueberdb1.get(key)!
    await ueberdb2.set(key, foundVal)
  }
}

handleSync().then(()=>{
  console.log("Done syncing dbs")
}).catch(e=>{
  console.log(`Error syncing db ${e}`)
})


