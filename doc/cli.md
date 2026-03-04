# CLI

You can find different tools for migrating things, checking your Etherpad health in the bin directory.
One of these is the migrateDB command. It takes two settings.json files and copies data from one source to another one.
In this example we migrate from the old dirty db to the new rustydb engine. So we copy these files to the root of the etherpad-directory.

````json
{
  "dbType": "dirty",
  "dbSettings": {
    "filename": "./var/rusty.db"
  }
}
````



````json
{
  "dbType": "rustydb",
  "dbSettings": {
    "filename": "./var/rusty2.db"
  }
}
````


After that we need to move the data from dirty to rustydb.
Therefore, we call `pnpm run --filter bin migrateDB --file1 test1.json --file2 test2.json` with these two files in our root directories. After some time the data should be copied over to the new database.
