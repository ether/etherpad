# Database structure

## Keys and their values

### groups
A list of all existing groups (a JSON object with groupIDs as keys and `1` as values).

### pad:$PADID
Contains all information about pads

- **atext** - the latest attributed text
- **pool** - the attribute pool
- **head** - the number of the latest revision
- **chatHead** - the number of the latest chat entry
- **public** - flag that disables security for this pad
- **passwordHash** - string that contains a salted sha512 sum of this pad's password

### pad:$PADID:revs:$REVNUM
Saves a revision $REVNUM of pad $PADID

- **meta**
  - **author** - the autorID of this revision
  - **timestamp** - the timestamp of when this revision was created
- **changeset** - the changeset of this revision

### pad:$PADID:chat:$CHATNUM
Saves a chat entry with num $CHATNUM of pad $PADID

- **text** - the text of this chat entry
- **userId** - the authorID of this chat entry
- **time** - the timestamp of this chat entry

### pad2readonly:$PADID
Translates a padID to a readonlyID

### readonly2pad:$READONLYID
Translates a readonlyID to a padID

### token2author:$TOKENID
Translates a token to an authorID

### globalAuthor:$AUTHORID
Information about an author

- **name** - the name of this author as shown in the pad
- **colorID** - the colorID of this author as shown in the pad

### mapper2group:$MAPPER
Maps an external application identifier to an internal group

### mapper2author:$MAPPER
Maps an external application identifier to an internal author

### group:$GROUPID
a group of pads

- **pads** - object with pad names in it, values are 1

### session:$SESSIONID
a session between an author and a group

- **groupID** - the groupID the session belongs too
- **authorID** - the authorID the session belongs too
- **validUntil** - the timestamp until this session is valid

### author2sessions:$AUTHORID
saves the sessions of an author

- **sessionsIDs** - object with sessionIDs in it, values are 1

### group2sessions:$GROUPID

- **sessionsIDs** - object with sessionIDs in it, values are 1

# Connecting to a database backend

Etherpad stores everything in a single key/value table through
[ueberDB](https://www.npmjs.com/package/ueberdb2), so the same data model works
across many backends. The backend is selected with `dbType` in `settings.json`,
and backend-specific connection options go in `dbSettings`.

The default `dirty` backend writes to a local file (`var/dirty.db`) and needs no
setup, which is convenient for development but not recommended for production.
For a production instance, point Etherpad at a real database such as MySQL/MariaDB,
PostgreSQL or Redis. Etherpad creates its own table on first run; you only need
to provision an empty database and a user with access to it.

## MySQL / MariaDB

Create the database and a user, then grant access:

```sql
CREATE DATABASE `etherpad` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'etherpad'@'localhost' IDENTIFIED BY 'a-secure-password';
GRANT CREATE,ALTER,SELECT,INSERT,UPDATE,DELETE ON `etherpad`.* TO 'etherpad'@'localhost';
```

Then configure `settings.json`:

```json
"dbType": "mysql",
"dbSettings": {
  "user":     "etherpad",
  "host":     "localhost",
  "port":     3306,
  "password": "a-secure-password",
  "database": "etherpad",
  "charset":  "utf8mb4"
}
```

Setting `charset` to `utf8mb4` is strongly recommended so that the full range of
Unicode (including emoji) is stored correctly. To connect over a local socket
instead of TCP, replace `host`/`port` with `"socketPath": "/var/run/mysqld/mysqld.sock"`.

## PostgreSQL

Create the user and a database owned by it:

```sql
CREATE USER etherpad WITH PASSWORD 'a-secure-password';
CREATE DATABASE etherpad OWNER etherpad;
```

Then configure `settings.json`:

```json
"dbType": "postgres",
"dbSettings": {
  "user":     "etherpad",
  "host":     "localhost",
  "port":     5432,
  "password": "a-secure-password",
  "database": "etherpad"
}
```

The `dbSettings` object is passed straight to the `node-postgres` connection
pool, so any option it accepts (including a single `"connectionString"`) works.
On Debian/Ubuntu you can use peer authentication over the local socket by
setting `"host": "/var/run/postgresql"` and an empty password, provided the
operating-system user that runs Etherpad matches the PostgreSQL role.

## Redis

Install Redis and make sure it persists data to disk. Configure `settings.json`
with either discrete fields or a single connection URL:

```json
"dbType": "redis",
"dbSettings": {
  "host":     "localhost",
  "port":     6379,
  "password": "a-secure-redis-password"
}
```

```json
"dbType": "redis",
"dbSettings": {
  "url": "redis://:a-secure-redis-password@localhost:6379"
}
```

## Migrating from MySQL to PostgreSQL

[pgloader](https://pgloader.io/) can copy an existing Etherpad database from
MySQL to PostgreSQL. Stop Etherpad first so the source database is quiescent.

```bash
sudo apt-get install postgresql pgloader

# Create the target role and database
sudo -u postgres createuser etherpad
sudo -u postgres createdb -O etherpad etherpad

# Describe and run the migration
cat > pgloader.load <<'EOF'
LOAD DATABASE
    FROM     mysql://etherpad:MYSQL_PASSWORD@127.0.0.1/etherpad
    INTO     postgresql:///etherpad
WITH        preserve index names, prefetch rows = 100
ALTER SCHEMA 'etherpad' RENAME TO 'public';
EOF

pgloader --verbose pgloader.load
```

Afterwards set the PostgreSQL user's password and make sure it can read and
write the migrated table:

```sql
ALTER USER etherpad WITH PASSWORD 'a-secure-password';
GRANT pg_read_all_data  TO etherpad;
GRANT pg_write_all_data TO etherpad;
```

Then point `settings.json` at PostgreSQL as shown above and start Etherpad.

::: tip
To move data between *any* two backends supported by ueberDB, you can also
use the `migrateDB` CLI tool, which reads every record from a source database
descriptor and writes it to a target one. See the [CLI chapter](./cli.md).
:::
