# HTTP API

## What can I do with this API?

The API gives another web application control of the pads. The basic functions are

* create/delete pads
* grant/forbid access to pads
* get/set pad content

The API is designed in a way, so you can reuse your existing user system with their permissions, and map it to Etherpad. Means: Your web application still has to do authentication, but you can tell Etherpad via the api, which visitors should get which permissions. This allows Etherpad to fit into any web application and extend it with real-time functionality. You can embed the pads via an iframe into your website.

Take a look at [HTTP API client libraries](https://github.com/ether/etherpad-lite/wiki/HTTP-API-client-libraries) to check if a library in your favorite programming language is available.

### OpenAPI

OpenAPI (formerly swagger) definitions are exposed under `/api/openapi.json` (latest) and `/api/{version}/openapi.json`. You can use official tools like [Swagger Editor](https://editor.swagger.io/) to view and explore them.

## Examples

### Example 1

A portal (such as WordPress) wants to give a user access to a new pad. Let's assume the user have the internal id 7 and his name is michael.

Portal maps the internal userid to an etherpad author.


#### Request

```http
GET /api/1/createAuthorIfNotExistsFor?name=Michael&authorMapper=7
```


### Response

```json
{"code": 0, "message":"ok", "data": {"authorID": "a.s8oes9dhwrvt0zif"}}
```

#### Request
> Portal maps the internal userid to an etherpad group:

```http
GET http://pad.domain/api/1/createGroupIfNotExistsFor?groupMapper=7
```

### Response

```json
{"code": 0, "message":"ok", "data": {"groupID": "g.s8oes9dhwrvt0zif"}}
```

> Portal creates a pad in the userGroup

#### Request

```http
GET http://pad.domain/api/1/createGroupPad?groupID=g.s8oes9dhwrvt0zif&padName=samplePad&text=This is the first sentence in the pad
```

#### Response

```json
{"code": 0, "message":"ok", "data": null}
```

> Portal starts the session for the user on the group:

#### Request

```http
GET http://pad.domain/api/1/createSession?groupID=g.s8oes9dhwrvt0zif&authorID=a.s8oes9dhwrvt0zif&validUntil=1312201246
```

### Response
    
```json
{"code": 0, "message":"ok", "data": {"sessionID": "s.s8oes9dhwrvt0zif"}}
```

Portal places the cookie "sessionID" with the given value on the client and creates an iframe including the pad.

### Example 2

A portal (such as WordPress) wants to transform the contents of a pad that multiple admins edited into a blog post.

Portal retrieves the contents of the pad for entry into the db as a blog post:

> Request: `http://pad.domain/api/1/getText?&padID=g.s8oes9dhwrvt0zif$123`
>
> Response: `{code: 0, message:"ok", data: {text:"Welcome Text"}}`

Portal submits content into new blog post

> Portal.AddNewBlog(content)

## Usage

### API version
The latest version is `1.2.15`

The current version can be queried via /api.

### Request Format

The API is accessible via HTTP. Starting from **1.8**, API endpoints can be invoked indifferently via GET or POST.

The URL of the HTTP request is of the form: `/api/$APIVERSION/$FUNCTIONNAME`. $APIVERSION depends on the endpoint you want to use. Depending on the verb you use (GET or POST) **parameters** can be passed differently.

When invoking via GET (mandatory until **1.7.5** included), parameters must be included in the query string (example: `/api/$APIVERSION/$FUNCTIONNAME?param1=value1`). Please note that starting with nodejs 8.14+ the total size of HTTP request headers has been capped to 8192 bytes. This limits the quantity of data that can be sent in an API request.

Starting from Etherpad **1.8** it is also possible to invoke the HTTP API via POST. In this case, querystring parameters will still be accepted, but **any parameter with the same name sent via POST will take precedence**. If you need to send large chunks of text (for example, for `setText()`) it is advisable to invoke via POST.

Example with cURL using GET (toy example, no encoding):
```
curl "http://pad.domain/api/1/setText?padID=padname&text=this_text_will_NOT_be_encoded_by_curl_use_next_example"
```

Example with cURL using GET (better example, encodes text):
```
curl "http://pad.domain/api/1/setText?padID=padname" --get --data-urlencode "text=Text sent via GET with proper encoding. For big documents, please use POST"
```

Example with cURL using POST:
```
curl "http://pad.domain/api/1/setText?padID=padname" --data-urlencode "text=Text sent via POST with proper encoding. For big texts (>8 KB), use this method"
```

### Response Format
Responses are valid JSON in the following format:

```json
{
  "code": number,
  "message": string,
  "data": obj
}
```

* **code** a return code
  * **0** everything ok
  * **1** wrong parameters
  * **2** internal error
  * **3** no such function
  * **4** no or wrong API Key
* **message** a status message. It's ok if everything is fine, else it contains an error message
* **data** the payload

### Overview

![API Overview](https://i.imgur.com/d0nWp.png)

## Data Types

* **groupID**  a string, the unique id of a group. Format is g.16RANDOMCHARS, for example g.s8oes9dhwrvt0zif
* **sessionID** a string, the unique id of a session. Format is s.16RANDOMCHARS, for example s.s8oes9dhwrvt0zif
* **authorID** a string, the unique id of an author. Format is a.16RANDOMCHARS, for example a.s8oes9dhwrvt0zif
* **readOnlyID** a string, the unique id of a readonly relation to a pad. Format is r.16RANDOMCHARS, for example r.s8oes9dhwrvt0zif
* **padID** a string, format is GROUPID$PADNAME, for example the pad test of group g.s8oes9dhwrvt0zif has padID g.s8oes9dhwrvt0zif$test

### Authentication

Authentication works via an OAuth token that is sent with each request as an Authorization header, i.e. `Authorization: Bearer YOUR_TOKEN`. You can add new clients that can sign in via the API by adding new entries to the sso section in the settings.json.


#### Example for browser login clients

This example illustrates how to add a new client that can sign in via the API using the browser login method. This method is used for users trying to sign in to the API via the browser. You can log in with the users in the settings.json file. The redirect URI is the URL where the user is redirected after the login. This is normally your etherpad instance url.

```json
      {
        "client_id": "admin_client",
        "client_secret": "admin",
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "redirect_uris": ["http://my-etherpad-instance.com"],
      }
```


#### Example for services

This example illustrates how to add a new client that can sign in via the API using the client credentials method. This method is used for services trying to sign in to the API where there is no browser.
E.g. a service that creates a pad for a user or a service that inserts a text into a pad. Just make sure that the secret is complex enough as anybody who knows the secret can access the API.

```json
      {
  "client_id": "client_credentials",
  "redirect_uris": [],
  "response_types": [],
  "grant_types": ["code"],
  "client_secret": "client_credentials",
  "extraParams": [
    {
      "name": "admin",
      "value": "true"
    }
  ]
}
```

Obtain a Bearer token:

`curl --request POST --url 'https://your.server.tld/oidc/token' --header 'content-type: application/x-www-form-urlencoded' --data grant_type=client_credentials --data client_id=client_credentials --data client_secret=client_credentials`


### Node Interoperability

All functions will also be available through a node module accessible from other node.js applications.

## API Methods

### Groups
Pads can belong to a group. The padID of grouppads is starting with a groupID like `g.asdfasdfasdfasdf$test`

#### createGroup()
* API >= 1

creates a new group

*Example returns:*
* `{code: 0, message:"ok", data: {groupID: g.s8oes9dhwrvt0zif}}`

#### createGroupIfNotExistsFor(groupMapper)
* API >= 1

this functions helps you to map your application group ids to Etherpad group ids

*Example returns:*
* `{code: 0, message:"ok", data: {groupID: g.s8oes9dhwrvt0zif}}`

#### deleteGroup(groupID)
* API >= 1

deletes a group

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"groupID does not exist", data: null}`

#### listPads(groupID)
* API >= 1

returns all pads of this group

*Example returns:*
* `{code: 0, message:"ok", data: {padIDs : ["g.s8oes9dhwrvt0zif$test", "g.s8oes9dhwrvt0zif$test2"]}`
* `{code: 1, message:"groupID does not exist", data: null}`

#### createGroupPad(groupID, padName, [text], [authorId])
* API >= 1
* `authorId` in API >= 1.3.0

creates a new pad in this group

*Example returns:*
* `{code: 0, message:"ok", data: {padID: "g.s8oes9dhwrvt0zif$test"}`
* `{code: 1, message:"padName does already exist", data: null}`
* `{code: 1, message:"groupID does not exist", data: null}`

#### listAllGroups()
* API >= 1.1

lists all existing groups

*Example returns:*
* `{code: 0, message:"ok", data: {groupIDs: ["g.mKjkmnAbSMtCt8eL", "g.3ADWx6sbGuAiUmCy"]}}`
* `{code: 0, message:"ok", data: {groupIDs: []}}`

### Author
These authors are bound to the attributes the users choose (color and name).

#### createAuthor([name])
* API >= 1

creates a new author

*Example returns:*
* `{code: 0, message:"ok", data: {authorID: "a.s8oes9dhwrvt0zif"}}`

#### createAuthorIfNotExistsFor(authorMapper [, name])
* API >= 1

this functions helps you to map your application author ids to Etherpad author ids

*Example returns:*
* `{code: 0, message:"ok", data: {authorID: "a.s8oes9dhwrvt0zif"}}`

#### listPadsOfAuthor(authorID)
* API >= 1

returns an array of all pads this author contributed to

*Example returns:*
* `{code: 0, message:"ok", data: {padIDs: ["g.s8oes9dhwrvt0zif$test", "g.s8oejklhwrvt0zif$foo"]}}`
* `{code: 1, message:"authorID does not exist", data: null}`

#### getAuthorName(authorID)
* API >= 1.1

Returns the Author Name of the author

*Example returns:*
* `{code: 0, message:"ok", data: {authorName: "John McLear"}}`

-> can't be deleted cause this would involve scanning all the pads where this author was

### Session
Sessions can be created between a group and an author. This allows an author to access more than one group. The sessionID will be set as a cookie to the client and is valid until a certain date. The session cookie can also contain multiple comma-separated sessionIDs, allowing a user to edit pads in different groups at the same time. Only users with a valid session for this group, can access group pads. You can create a session after you authenticated the user at your web application, to give them access to the pads. You should save the sessionID of this session and delete it after the user logged out.

#### createSession(groupID, authorID, validUntil)
* API >= 1

creates a new session. validUntil is an unix timestamp in seconds

*Example returns:*
* `{code: 0, message:"ok", data: {sessionID: "s.s8oes9dhwrvt0zif"}}`
* `{code: 1, message:"groupID doesn't exist", data: null}`
* `{code: 1, message:"authorID doesn't exist", data: null}`
* `{code: 1, message:"validUntil is in the past", data: null}`


#### deleteSession(sessionID)
* API >= 1

deletes a session

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"sessionID does not exist", data: null}`

#### getSessionInfo(sessionID)
* API >= 1

returns information about a session

*Example returns:*
* `{code: 0, message:"ok", data: {authorID: "a.s8oes9dhwrvt0zif", groupID: g.s8oes9dhwrvt0zif, validUntil: 1312201246}}`
* `{code: 1, message:"sessionID does not exist", data: null}`

#### listSessionsOfGroup(groupID)
* API >= 1

returns all sessions of a group

*Example returns:*
* `{"code":0,"message":"ok","data":{"s.oxf2ras6lvhv2132":{"groupID":"g.s8oes9dhwrvt0zif","authorID":"a.akf8finncvomlqva","validUntil":2312905480}}}`
* `{code: 1, message:"groupID does not exist", data: null}`

#### listSessionsOfAuthor(authorID)
* API >= 1

returns all sessions of an author

*Example returns:*
* `{"code":0,"message":"ok","data":{"s.oxf2ras6lvhv2132":{"groupID":"g.s8oes9dhwrvt0zif","authorID":"a.akf8finncvomlqva","validUntil":2312905480}}}`
* `{code: 1, message:"authorID does not exist", data: null}`

### Pad Content

Pad content can be updated and retrieved through the API

#### getText(padID, [rev])
* API >= 1

returns the text of a pad

*Example returns:*
* `{code: 0, message:"ok", data: {text:"Welcome Text"}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### setText(padID, text, [authorId])
* API >= 1
* `authorId` in API >= 1.3.0

Sets the text of a pad.

If your text is long (>8 KB), please invoke via POST and include `text` parameter in the body of the request, not in the URL (since Etherpad **1.8**).

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`
* `{code: 1, message:"text too long", data: null}`

#### appendText(padID, text, [authorId])
* API >= 1.2.13
* `authorId` in API >= 1.3.0


Appends text to a pad.

If your text is long (>8 KB), please invoke via POST and include `text` parameter in the body of the request, not in the URL (since Etherpad **1.8**).

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`
* `{code: 1, message:"text too long", data: null}`

#### getHTML(padID, [rev])
* API >= 1

returns the text of a pad formatted as HTML

*Example returns:*
* `{code: 0, message:"ok", data: {html:"Welcome Text<br>More Text"}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### setHTML(padID, html, [authorId])
* API >= 1
* `authorId` in API >= 1.3.0

sets the text of a pad based on HTML, HTML must be well-formed. Malformed HTML will send a warning to the API log.

If `html` is long (>8 KB), please invoke via POST and include `html` parameter in the body of the request, not in the URL (since Etherpad **1.8**).

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`

#### getAttributePool(padID)
* API >= 1.2.8

returns the attribute pool of a pad

*Example returns:*
* `{ "code":0,
  "message":"ok",
  "data": {
  "pool":{
  "numToAttrib":{
  "0":["author","a.X4m8bBWJBZJnWGSh"],
  "1":["author","a.TotfBPzov54ihMdH"],
  "2":["author","a.StiblqrzgeNTbK05"],
  "3":["bold","true"]
  },
  "attribToNum":{
  "author,a.X4m8bBWJBZJnWGSh":0,
  "author,a.TotfBPzov54ihMdH":1,
  "author,a.StiblqrzgeNTbK05":2,
  "bold,true":3
  },
  "nextNum":4
  }
  }
  }`
* `{"code":1,"message":"padID does not exist","data":null}`

#### getRevisionChangeset(padID, [rev])
* API >= 1.2.8

get the changeset at a given revision, or last revision if 'rev' is not defined.

*Example returns:*
* `{ "code" : 0,
  "message" : "ok",
  "data" : "Z:1>6b|5+6b$Welcome to Etherpad!\n\nThis pad text is synchronized as you type, so that everyone viewing this page sees the same text. This allows you to collaborate seamlessly on documents!\n\nGet involved with Etherpad at https://etherpad.org\n"
  }`
* `{"code":1,"message":"padID does not exist","data":null}`
* `{"code":1,"message":"rev is higher than the head revision of the pad","data":null}`

#### createDiffHTML(padID, startRev, endRev)
* API >= 1.2.7

returns an object of diffs from 2 points in a pad

*Example returns:*
* `{"code":0,"message":"ok","data":{"html":"<style>\n.authora_HKIv23mEbachFYfH {background-color: #a979d9}\n.authora_n4gEeMLsv1GivNeh {background-color: #a9b5d9}\n.removed {text-decoration: line-through; -ms-filter:'progid:DXImageTransform.Microsoft.Alpha(Opacity=80)'; filter: alpha(opacity=80); opacity: 0.8; }\n</style>Welcome to Etherpad!<br><br>This pad text is synchronized as you type, so that everyone viewing this page sees the same text. This allows you to collaborate seamlessly on documents!<br><br>Get involved with Etherpad at <a href=\"http&#x3a;&#x2F;&#x2F;etherpad&#x2e;org\">http:&#x2F;&#x2F;etherpad.org</a><br><span class=\"authora_HKIv23mEbachFYfH\">aw</span><br><br>","authors":["a.HKIv23mEbachFYfH",""]}}`
* `{"code":4,"message":"no or wrong API Key","data":null}`

#### restoreRevision(padId, rev, [authorId])
* API >= 1.2.11
* `authorId` in API >= 1.3.0

* Example returns:*
* `{code:0, message:"ok", data:null}`
* `{code: 1, message:"padID does not exist", data: null}`

### Chat
#### getChatHistory(padID, [start, end])
* API >= 1.2.7

returns

* a part of the chat history, when `start` and `end` are given
* the whole chat history, when no extra parameters are given


*Example returns:*

* `{"code":0,"message":"ok","data":{"messages":[{"text":"foo","userId":"a.foo","time":1359199533759,"userName":"test"},{"text":"bar","userId":"a.foo","time":1359199534622,"userName":"test"}]}}`
* `{code: 1, message:"start is higher or equal to the current chatHead", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`

#### getChatHead(padID)
* API >= 1.2.7

returns the chatHead (last number of the last chat-message) of the pad


*Example returns:*

* `{code: 0, message:"ok", data: {chatHead: 42}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### appendChatMessage(padID, text, authorID [, time])
* API >= 1.2.12

creates a chat message, saves it to the database and sends it to all connected clients of this pad

*Example returns:*

* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"text is no string", data: null}`

### Pad
Group pads are normal pads, but with the name schema GROUPID$PADNAME. A security manager controls access of them and it's forbidden for normal pads to include a $ in the name.

#### createPad(padID, [text], [authorId])
* API >= 1
* `authorId` in API >= 1.3.0

creates a new (non-group) pad.  Note that if you need to create a group Pad, you should call **createGroupPad**.
You get an error message if you use one of the following characters in the padID: "/", "?", "&" or "#".

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does already exist", data: null}`
* `{code: 1, message:"malformed padID: Remove special characters", data: null}`

#### getRevisionsCount(padID)
* API >= 1

returns the number of revisions of this pad

*Example returns:*
* `{code: 0, message:"ok", data: {revisions: 56}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### getSavedRevisionsCount(padID)
* API >= 1.2.11

returns the number of saved revisions of this pad

*Example returns:*
* `{code: 0, message:"ok", data: {savedRevisions: 42}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### listSavedRevisions(padID)
* API >= 1.2.11

returns the list of saved revisions of this pad

*Example returns:*
* `{code: 0, message:"ok", data: {savedRevisions: [2, 42, 1337]}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### saveRevision(padID [, rev])
* API >= 1.2.11

saves a revision

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`

#### padUsersCount(padID)
* API >= 1

returns the number of user that are currently editing this pad

*Example returns:*
* `{code: 0, message:"ok", data: {padUsersCount: 5}}`

#### padUsers(padID)
* API >= 1.1

returns the list of users that are currently editing this pad

*Example returns:*
* `{code: 0, message:"ok", data: {padUsers: [{colorId:"#c1a9d9","name":"username1","timestamp":1345228793126,"id":"a.n4gEeMLsvg12452n"},{"colorId":"#d9a9cd","name":"Hmmm","timestamp":1345228796042,"id":"a.n4gEeMLsvg12452n"}]}}`
* `{code: 0, message:"ok", data: {padUsers: []}}`

#### deletePad(padID)
* API >= 1

deletes a pad

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`

#### copyPad(sourceID, destinationID[, force=false])
* API >= 1.2.8

copies a pad with full history and chat. If force is true and the destination pad exists, it will be overwritten.

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`

#### copyPadWithoutHistory(sourceID, destinationID, [force=false], [authorId])
* API >= 1.2.15
* `authorId` in API >= 1.3.0

copies a pad without copying the history and chat. If force is true and the destination pad exists, it will be overwritten.
Note that all the revisions will be lost! In most of the cases one should use `copyPad` API instead.

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`

#### movePad(sourceID, destinationID[, force=false])
* API >= 1.2.8

moves a pad. If force is true and the destination pad exists, it will be overwritten.

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`

#### getReadOnlyID(padID)
* API >= 1

returns the read only link of a pad

*Example returns:*
* `{code: 0, message:"ok", data: {readOnlyID: "r.s8oes9dhwrvt0zif"}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### getPadID(readOnlyID)
* API >= 1.2.10

returns the id of a pad which is assigned to the readOnlyID

*Example returns:*
* `{code: 0, message:"ok", data: {padID: "p.s8oes9dhwrvt0zif"}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### setPublicStatus(padID, publicStatus)
* API >= 1

sets a boolean for the public status of a group pad

*Example returns:*
* `{code: 0, message:"ok", data: null}`
* `{code: 1, message:"padID does not exist", data: null}`
* `{code: 1, message:"You can only get/set the publicStatus of pads that belong to a group", data: null}`

#### getPublicStatus(padID)
* API >= 1

return true of false

*Example returns:*
* `{code: 0, message:"ok", data: {publicStatus: true}}`
* `{code: 1, message:"padID does not exist", data: null}`
* `{code: 1, message:"You can only get/set the publicStatus of pads that belong to a group", data: null}`

#### listAuthorsOfPad(padID)
* API >= 1

returns an array of authors who contributed to this pad

*Example returns:*
* `{code: 0, message:"ok", data: {authorIDs : ["a.s8oes9dhwrvt0zif", "a.akf8finncvomlqva"]}`
* `{code: 1, message:"padID does not exist", data: null}`

#### getLastEdited(padID)
* API >= 1

returns the timestamp of the last revision of the pad

*Example returns:*
* `{code: 0, message:"ok", data: {lastEdited: 1340815946602}}`
* `{code: 1, message:"padID does not exist", data: null}`

#### sendClientsMessage(padID, msg)
* API >= 1.1

sends a custom message of type `msg` to the pad

*Example returns:*
```json
{"code": 0, "message":"ok", "data": {}}
```

```json
{"code": 1, "message":"padID does not exist", "data": null}
```

#### checkToken()
* API >= 1.2

returns ok when the current api token is valid

*Example returns:*
```json
{"code":0,"message":"ok","data":null}
```
```json
{"code":4,"message":"no or wrong API Key","data":null}
```

### Pads

#### listAllPads()
* API >= 1.2.1

lists all pads on this epl instance

*Example returns:*
```json
{"code": 0, "message":"ok", "data": {"padIDs": ["testPad", "thePadsOfTheOthers"]}}
```

### Global

#### getStats()
*  API >= 1.2.14

get stats of the etherpad instance

*Example returns*
```json
{"code":0,"message":"ok","data":{"totalPads":3,"totalSessions": 2,"totalActivePads": 1}}
```

