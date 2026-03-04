import {ArgsExpressType} from "../types/ArgsExpressType";
import {MapArrayType} from "../types/MapType";
import {IncomingForm} from "formidable";
import {ErrorCaused} from "../types/ErrorCaused";
import createHTTPError from "http-errors";

const apiHandler = require('./APIHandler')
import {serve, setup} from 'swagger-ui-express'
import express from "express";

import settings from '../utils/Settings';


type RestAPIMapping = {
  apiVersion: string;
  functionName: string,
  summary?: string,
  operationId?: string,
  requestBody?: any,
  responses?: any,
  tags?: string[],
}


const mapping = new Map<string, Record<string, RestAPIMapping>>


const GET = "GET"
const POST = "POST"
const PUT = "PUT"
const DELETE = "DELETE"
const PATCH = "PATCH"


const defaultResponses = {
  "200": {
    "description": "ok (code 0)",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "properties": {
            "code": {
              "type": "integer",
              "example": 0
            },
            "message": {
              "type": "string",
              "example": "ok"
            },
            "data": {
              "type": "object",
              "properties": {
                "groupID": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    }
  },
  "400": {
    "description": "generic api error (code 1)",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "properties": {
            "code": {
              "type": "integer",
              "example": 1
            },
            "message": {
              "type": "string",
              "example": "error message"
            },
            "data": {
              "type": "object",
              "example": null
            }
          }
        }
      }
    }
  },
  "401": {
    "description": "no or wrong API key (code 4)",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "properties": {
            "code": {
              "type": "integer",
              "example": 4
            },
            "message": {
              "type": "string",
              "example": "no or wrong API key"
            },
            "data": {
              "type": "object",
              "example": null
            }
          }
        }
      }
    }
  },
  "500": {
    "description": "internal api error (code 2)",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "properties": {
            "code": {
              "type": "integer",
              "example": 2
            },
            "message": {
              "type": "string",
              "example": "internal error"
            },
            "data": {
              "type": "object",
              "example": null
            }
          }
        }
      }
    }
  },
  "tags": [
    "group"
  ],
  "parameters": []
}

const prepareResponses = (data: {
  type: string,
  properties: Record<string, {
    type: string,
    items?: Record<string, any>,
    properties?: Record<string, any>,
  }>,
}) => {
  return {
    ...defaultResponses,
    200: {
      ...defaultResponses["200"],
      content: {
        ...defaultResponses["200"].content,
        "application/json": {
          schema: {
            type: "object",
            properties: {
              ...defaultResponses["200"].content["application/json"].schema.properties,
              data: data
            }
          }
        }
      }
    }
  }
}


const prepareDefinition = (mapping: Map<string, Record<string, RestAPIMapping>>, address: string) => {
  const authenticationMethod = settings.authenticationMethod


  const definitions: {
    "openapi": string,
    "info": {
      "title": string,
      "description": string,
      "termsOfService": string,
      "contact": {
        "name": string,
        "url": string,
        "email": string,
      },
    },
    "components": {
      "securitySchemes": {
        "apiKey": {
          "type": string,
          "name": string,
          "in": string

        },
        "sso"?: {
          "type": string,
          "flows": {
            "authorizationCode": {
              "authorizationUrl": string,
              "tokenUrl": string,
              "scopes": {
                "openid": string,
                "profile": string,
                "email": string,
                "admin": string
              }
            }
          }
        }
      },
    },
    "servers": [
      {
        "url": string
      }
    ],
    "paths": Record<string, Record<string, {
      "summary": string,
      "operationId": string,
      "requestBody"?: any,
      "responses": any,
      "parameters"?: any,
      "tags": Array<string | { name: string, description: string }>,
    }>>,
    "security": any[]
  } = {
    "openapi": "3.0.2",
    "info": {
      "title": "Etherpad API",
      "description": "Etherpad is a real-time collaborative editor scalable to thousands of simultaneous real time users. It provides full data export capabilities, and runs on your server, under your control.",
      "termsOfService": "https://etherpad.org/",
      "contact": {
        "name": "The Etherpad Foundation",
        "url": "https://etherpad.org/",
        "email": "",
      },
    },
    "components": {
      "securitySchemes": {
        "apiKey": {
          "type": "apiKey",
          "name": "apikey",
          "in": "query"

        },
      },
    },
    "servers": [
      {
        "url": `${address}/api/2`
      }
    ],
    "paths": {},
    "security": []
  }

  if (authenticationMethod === "apikey") {
    definitions.security = [
      {
        "apiKey": []
      }
    ]
  } else if (authenticationMethod === "sso") {
    definitions.components.securitySchemes.sso = {
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: settings.sso.issuer + "/oidc/auth",
          tokenUrl: settings.sso.issuer + "/oidc/token",
          scopes: {
            openid: "openid",
            profile: "profile",
            email: "email",
            admin: "admin"
          }
        }
      },
    }

    definitions.security = [
      {
        "sso": []
      }
    ]
  }


  for (const [method, value] of mapping) {
    for (const [path, mapping] of Object.entries(value)) {
      const {apiVersion, functionName, summary, operationId, requestBody, responses, tags} = mapping
      if (!definitions.paths[path]) {
        definitions.paths[path] = {}
      }

      const methodLowercased = method.toLowerCase()

      definitions.paths[path][methodLowercased] = {
        summary: summary!,
        operationId: operationId!,
        responses,
        tags: tags!
      }

      if (method === GET) {
        definitions.paths[path][methodLowercased].parameters = requestBody
      } else {
        definitions.paths[path][methodLowercased].requestBody = requestBody
      }
    }
  }
  return definitions
}


export const expressCreateServer = async (hookName: string, {app}: ArgsExpressType) => {
  mapping.set(GET, {})
  mapping.set(POST, {})
  mapping.set(PUT, {})
  mapping.set(DELETE, {})
  mapping.set(PATCH, {})

  // Version 1
  mapping.get(POST)!["/groups"] = {
    apiVersion: '1',
    functionName: 'createGroup', summary: 'Creates a new group',
    operationId: 'createGroup', tags: ['group'], responses: prepareResponses({type: "object", properties: {groupID: {type: "string"}}})

  }
  mapping.get(POST)!["/groups/createIfNotExistsFor"] = {
    apiVersion: '1', functionName: 'createGroupIfNotExistsFor',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              groupMapper: {
                type: "string"
              }
            },
            required: ["groupMapper"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {groupID: {type: "string"}}}),
    summary: "Creates a new group if it doesn't exist", operationId: 'createGroupIfNotExistsFor', tags: ['group']
  };
  mapping.get(GET)!["/groups/pads"] = {
    apiVersion: '1', functionName: 'listPads',
    summary: "Lists all pads in a group", tags: ['group'],
    operationId: 'listPads', responses: prepareResponses({type: "object", properties: {padIDs: {type: "string"}}}),
    requestBody: [
      {
        "name": "groupID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ]
  }
  mapping.get(DELETE)!["/groups"] = {
    apiVersion: '1', functionName: 'deleteGroup', responses: prepareResponses({type: "object", properties: {}}), requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              groupID: {
                type: "string"
              }
            },
            required: ["groupID"]
          }
        }
      }
    }, summary: "Deletes a group", operationId: 'deleteGroup', tags: ['group']
  }

  mapping.get(POST)!["/authors"] = {
    apiVersion: '1', functionName: 'createAuthor', requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: {
                type: "string"
              }
            },
            required: ["name"]
          }
        }
      }
    }, tags: ["author"]
  }


  mapping.get(POST)!["/authors/createIfNotExistsFor"] = {
    apiVersion: '1', functionName: 'createAuthorIfNotExistsFor',
    responses: prepareResponses({type: "object", properties: {authorID: {type: "string"}}}),
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              authorMapper: {
                type: "string"
              },
              name: {
                type: "string"
              }
            },
            required: ["authorMapper", "name"]
          }
        }
      }
    },
    tags: ["author"],
  }


  mapping.get(GET)!["/authors/pads"] = {
    apiVersion: '1', functionName: 'listPadsOfAuthor',
    requestBody: [
      {
        "name": "authorID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    responses: prepareResponses({type: "object", properties: {padIDs: {type: "array", items: {type: "string"}}}}),
    tags: ["author"]
  }
  mapping.get(POST)!["/sessions"] = {
    apiVersion: '1', functionName: 'createSession',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              groupID: {
                type: "string"
              },
              authorID: {
                type: "string"
              },
              validUntil: {
                type: "string"
              }
            },
            required: ["groupID", "authorID", "validUntil"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {sessionID: {type: "string"}}}),
    tags: ['session']
  }

  mapping.get(DELETE)!["/sessions"] = {
    apiVersion: '1', functionName: 'deleteSession',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              sessionID: {
                type: "string"
              }
            },
            required: ["sessionID"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    tags: ['session']
  }


  mapping.get(GET)!["/sessions/info"] = {
    apiVersion: '1', functionName: 'getSessionInfo',
    requestBody: [
      {
        "name": "sessionID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    responses: prepareResponses({
      "type": "object",
      "properties": {
        id: {
          type: "string"
        },
        "groupID": {
          "type": "string"
        },
        "authorID": {
          "type": "string"
        },
        "validUntil": {
          "type": "string"
        }
      }
    }),
    tags: ['session']
  }


  mapping.get(GET)!["/sessions/group"] = {
    apiVersion: '1', functionName: 'listSessionsOfGroup', summary: 'Lists all sessions in a group',
    operationId: 'listSessionsOfGroup', tags: ['session'],
    responses: prepareResponses({
      type: "object", "properties": {
        "sessions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "authorID": {
                "type": "string"
              },
              "groupID": {
                "type": "string"
              },
              "validUntil": {
                "type": "integer"
              }
            }
          }
        }
      }
    }),
    requestBody: [
      {
        "name": "groupID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ]
  }
  mapping.get(GET)!["/sessions/author"] = {
    apiVersion: '1', functionName: 'listSessionsOfAuthor',
    summary: 'Lists all sessions of an author', operationId: 'listSessionsOfAuthor', tags: ['session'],
    responses: prepareResponses({
      type: "object", "properties": {
        "sessions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "authorID": {
                "type": "string"
              },
              "groupID": {
                "type": "string"
              },
              "validUntil": {
                "type": "integer"
              }
            }
          }
        }
      }
    }),
    requestBody: [
      {
        "name": "authorID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ]
  }


  mapping.get(GET)!["/pads/text"] = {
    apiVersion: '1', functionName: 'getText',
    responses: prepareResponses({type: "object", properties: {text: {type: "string"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    tags: ['pad']
  }


  mapping.get(GET)!["/pads/html"] = {
    apiVersion: '1', functionName: 'getHTML',
    responses: prepareResponses({type: "object", properties: {html: {type: "string"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the HTML of a pad',
    tags: ['pad']
  }
  mapping.get(GET)!["/pads/revisions"] = {
    apiVersion: '1', functionName: 'getRevisionsCount',
    responses: prepareResponses({type: "object", properties: {revisions: {type: "integer"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the number of revisions of a pad',
    tags: ['pad']
  }

  mapping.get(GET)!["/pads/lastEdited"] = {
    apiVersion: '1', functionName: 'getLastEdited',
    responses: prepareResponses({type: "object", properties: {lastEdited: {type: "integer"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the timestamp of the last revision of a pad',
    tags: ['pad']
  }


  mapping.get(DELETE)!["/pads"] = {
    apiVersion: '1', functionName: 'deletePad',
    responses: prepareResponses({type: "object", properties: {}}),
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              }
            },
            required: ["padID"]
          }
        }
      }
    },
    summary: 'Deletes a pad',
    tags: ['pad']
  }
  mapping.get(GET)!["/pads/readonly"] = {
    apiVersion: '1', functionName: 'getReadOnlyID',
    responses: prepareResponses({type: "object", properties: {readOnlyID: {type: "string"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the read only id of a pad',
    tags: ['pad']
  }

  mapping.get(POST)!["/pads/publicStatus"] = {
    apiVersion: '1', functionName: 'setPublicStatus',
    responses: prepareResponses({type: "object", properties: {}}),
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              publicStatus: {
                type: "boolean"
              }
            },
            required: ["padID", "publicStatus"]
          }
        }
      }
    },
    summary: 'Set the public status of a pad',
    tags: ['pad']

  }
  mapping.get(GET)!["/pads/publicStatus"] = {
    apiVersion: '1', functionName: 'getPublicStatus',
    responses: prepareResponses({type: "object", properties: {publicStatus: {type: "boolean"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the public status of a pad',
    tags: ['pad']
  }
  mapping.get(GET)!["/pads/authors"] = {
    apiVersion: '1', functionName: 'listAuthorsOfPad',
    responses: prepareResponses({type: "object", properties: {authorIDs: {type: "array", items: {type: "string"}}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the authors of a pad',
    tags: ['pad']
  }
  mapping.get(GET)!["/pads/usersCount"] = {
    apiVersion: '1', functionName: 'padUsersCount',
    responses: prepareResponses({type: "object", properties: {padUsersCount: {type: "integer"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the number of users currently editing a pad',
    tags: ['pad']
  }


  // Version 1.1
  mapping.get(GET)!["/authors/name"] = {
    apiVersion: '1.1', functionName: 'getAuthorName',
    responses: prepareResponses({type: "object", properties: {authorName: {type: "string"}}}),
    requestBody: [
      {
        "name": "authorID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the name of an author',
    tags: ['author']
  }
  mapping.get(GET)!["/pads/users"] = {
    apiVersion: '1.1', functionName: 'padUsers',
    responses: prepareResponses({
      type: "object", properties: {
        padUsers: {
          type: "array", "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "colorId": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "timestamp": {
                "type": "integer"
              }
            }
          }
        }
      }
    }),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the users currently editing a pad',
    tags: ['pad']
  }


  mapping.get(POST)!["/pads/clientsMessage"] = {
    apiVersion: '1.1', functionName: 'sendClientsMessage',
    responses: prepareResponses({type: "object", properties: {}}),
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              msg: {
                type: "string"
              }
            },
            required: ["padID", "msg"]
          }
        }
      }
    },
    summary: 'Send a message to all clients of a pad',
    tags: ['pad']
  }


  mapping.get(GET)!["/groups"] = {
    apiVersion: '1.1', functionName: 'listAllGroups',
    responses: prepareResponses({type: "object", properties: {groupIDs: {type: "array", items: {type: "string"}}}}),
    summary: 'Lists all groups',
    tags: ['group']
  }


  // Version 1.2
  mapping.get(GET)!["/checkToken"] = {
    apiVersion: '1.2', functionName: 'checkToken',
    responses: prepareResponses({type: "object", properties: {}}),
    requestBody: [
      {
        "name": "token",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Check if a token is valid',
    tags: ['token']

  }

  // Version 1.2.1
  mapping.get(GET)!["/pads"] = {
    apiVersion: '1.2.1', functionName: 'listAllPads',
    summary: 'Lists all pads',
    tags: ['pad'],
    requestBody: [
      {
        "name": "groupID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    responses: prepareResponses({type: "object", properties: {padIDs: {type: "array", items: {type: "string"}}}})
  }

  // Version 1.2.7
  mapping.get(POST)!["/pads/diff"] = {
    apiVersion: '1.2.7', functionName: 'createDiffHTML',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              startRev: {
                type: "integer"
              },
              endRev: {
                type: "integer"
              }
            },
            required: ["padID", "startRev", "endRev"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Creates a diff of a pad',
    tags: ['pad']
  }
  mapping.get(GET)!["/pads/chatHistory"] = {
    apiVersion: '1.2.7', functionName: 'getChatHistory',
    responses: prepareResponses({
      type: "object", properties: {
        messages: {
          type: "array", items: {
            type: "object", properties: {
              "text": {
                "type": "string"
              },
              "userId": {
                "type": "string"
              },
              "userName": {
                "type": "string"
              },
              "time": {
                "type": "integer"
              }
            }
          }
        }
      }
    }),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the chat history of a pad',
    tags: ['pad']
  }
  mapping.get(GET)!["/pads/chatHead"] = {
    apiVersion: '1.2.7', functionName: 'getChatHead',
    responses: prepareResponses({
      type: "object", properties: {
        chatHead: {
          type: "object",
          properties: {
            "text": {
              "type": "string"
            },
            "userId": {
              "type": "string"
            },
            "userName": {
              "type": "string"
            },
            "time": {
              "type": "integer"
            }
          }
        }

      }
    }),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the chat head of a pad',
    tags: ['pad']

  }

  // Version 1.2.8
  mapping.get(GET)!["/pads/attributePool"] = {
    apiVersion: '1.2.8', functionName: 'getAttributePool',
    responses: prepareResponses({type: "object", properties: {}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the attribute pool of a pad',
    tags: ['pad']
  }
  mapping.get(GET)!["/pads/revisionChangeset"] = {
    apiVersion: '1.2.8', functionName: 'getRevisionChangeset',
    responses: prepareResponses({type: "object", properties: {}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "rev",
        "in": "query",
        "schema": {
          "type": "integer"
        }
      }
    ],
    summary: 'Get the changeset of a revision of a pad',
    tags: ['pad']
  }

  // Version 1.2.9
  mapping.get(POST)!["/pads/copypad"] = {
    apiVersion: '1.2.9', functionName: 'copyPad',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              sourceID: {
                type: "string"
              },
              destinationID: {
                type: "string"
              },
              force: {
                type: "boolean"
              }
            },
            required: ["sourceID", "destinationID"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Copies a pad',
    tags: ['pad']
  }


  mapping.get(POST)!["/pads/movePad"] = {
    apiVersion: '1.2.9', functionName: 'movePad',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              sourceID: {
                type: "string"
              },
              destinationID: {
                type: "string"
              },
              force: {
                type: "boolean"
              }
            },
            required: ["sourceID", "destinationID"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Moves a pad',
    tags: ['pad']
  }

  // Version 1.2.10
  mapping.get(POST)!["/pads/padId"] = {
    apiVersion: '1.2.10', functionName: 'getPadID',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              roID: {
                type: "string"
              }
            },
            required: ["roID"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Get the pad id of a pad',
    tags: ['pad']
  }

  // Version 1.2.11
  mapping.get(GET)!["/savedRevisions"] = {
    apiVersion: '1.2.11', functionName: 'listSavedRevisions',
    responses: prepareResponses({type: "object", properties: {savedRevisions: {type: "array", items: {type: "object"}}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Lists all saved revisions of a pad',
    tags: ['pad']
  }


  mapping.get(POST)!["/savedRevisions"] = {
    apiVersion: '1.2.11', functionName: 'saveRevision',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              rev: {
                type: "integer"
              }
            },
            required: ["padID", "rev"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Saves a revision of a pad',
    tags: ['pad']
  }

  mapping.get(GET)!["/savedRevisions/revisionsCount"] = {
    apiVersion: '1.2.11', functionName: 'getSavedRevisionsCount',
    responses: prepareResponses({type: "object", properties: {revisionsCount: {type: "integer"}}}),
    requestBody: [
      {
        "name": "padID",
        "in": "query",
        "schema": {
          "type": "string"
        }
      }
    ],
    summary: 'Get the number of saved revisions of a pad',
    tags: ['pad']
  }

  // Version 1.2.12
  mapping.get(PATCH)!["/chats/messages"] = {
    apiVersion: '1.2.12', functionName: 'appendChatMessage',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              text: {
                type: "string"
              },
              authorID: {
                type: "string"
              },
              time: {
                type: "string"
              }
            },
            required: ["padID", "text"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Appends a chat message to a pad',
    tags: ['pad']
  }

  // Version 1.2.13

  // Version 1.2.14
  mapping.get(GET)!["/stats"] = {
    apiVersion: '1.2.14', functionName: 'getStats',
    responses: prepareResponses({type: "object", properties: {stats: {type: "object"}}}),
    summary: 'Get stats',
    tags: ['stats']
  }

  // Version 1.2.15

  // Version 1.3.0
  mapping.get(PATCH)!["/pads/text"] = {
    apiVersion: '1.3.0', functionName: 'appendText',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              text: {
                type: "string"
              },
              authorID: {
                type: "string"
              },
            },
            required: ["padID", "text", "authorID"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Appends text to a pad',
    tags: ['pad']
  }
  mapping.get(POST)!["/pads/copyWithoutHistory"] = {
    apiVersion: '1.3.0', functionName: 'copyPadWithoutHistory',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              sourceID: {
                type: "string"
              },
              destinationID: {
                type: "string"
              },
              force: {
                type: "string"
              },
              authorID: {
                type: "string"
              }
            },
            required: ["sourceID", "destinationID", "force", "authorID"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Copies a pad without its history',
    tags: ['pad']
  }
  mapping.get(POST)!["/pads/group"] = {
    apiVersion: '1.3.0', functionName: 'createGroupPad',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              groupID: {
                type: "string"
              },
              padName: {
                type: "string"
              },
              text: {
                type: "string"
              },
              authorID: {
                type: "string"
              }
            },
            required: ["groupID", "padName"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Creates a new pad in a group',
    tags: ['pad']

  }
  mapping.get(POST)!["/pads"] = {
    apiVersion: '1.3.0', functionName: 'createPad',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              text: {
                type: "string"
              },
              authorId: {
                type: "string"
              }
            },
            required: ["padName"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Creates a new pad',
    tags: ['pad']
  }
  mapping.get(PATCH)!["/savedRevisions"] = {
    apiVersion: '1.3.0', functionName: 'restoreRevision',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              rev: {
                type: "integer"
              },
              authorId: {
                type: "string"
              }
            },
            required: ["padID", "rev", "authorId"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Restores a revision of a pad',
    tags: ['pad']
  }


  mapping.get(POST)!["/pads/html"] = {
    apiVersion: '1.3.0', functionName: 'setHTML',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              html: {
                type: "string"
              },
              authorId: {
                type: "string"
              }
            },
            required: ["padID", "html", "authorId"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Sets the HTML of a pad',
    tags: ['pad']
  }

  mapping.get(POST)!["/pads/text"] = {
    apiVersion: '1.3.0', functionName: 'setText',
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              padID: {
                type: "string"
              },
              text: {
                type: "string"
              },
              authorId: {
                type: "string"
              }
            },
            required: ["padID", "text", "authorId"]
          }
        }
      }
    },
    responses: prepareResponses({type: "object", properties: {}}),
    summary: 'Sets the text of a pad',
    tags: ['pad']
  }


  app.use('/api-docs', serve);
  app.get('/api-docs', setup(undefined, {
    swaggerOptions: {
      url: '/api-docs.json',
    },
  }));

  app.use(express.json());

  app.get('/api-docs.json', (req, res) => {
    const fullUrl = req.protocol + '://' + req.get('host');
    const generatedDefinition = prepareDefinition(mapping, fullUrl)
    res.json(generatedDefinition)
  })
  app.use('/api/2', async (req, res, next) => {
    const method = req.method
    const pathToFunction = req.path
    // parse fields from request
    const {headers, params, query} = req;

    // read form data if method was POST
    let formData: MapArrayType<any> = {};
    if (method.toLowerCase() === 'post' || method.toLowerCase() === "delete") {
      if (!req.headers['content-type'] || req.headers['content-type']!.startsWith('application/json')) {
        // parse json
        formData = req.body;
      } else {
        const form = new IncomingForm();
        formData = (await form.parse(req))[0];
        for (const k of Object.keys(formData)) {
          if (formData[k] instanceof Array) {
            formData[k] = formData[k][0];
          }
        }
      }
    }

    const fields = Object.assign({}, headers, params, query, formData);

    if (mapping.has(method) && pathToFunction in mapping.get(method)!) {
      const {apiVersion, functionName} = mapping.get(method)![pathToFunction]!
      // pass to api handler
      let response;
      try {
        try {
          let data = await apiHandler.handle(apiVersion, functionName, fields, req, res);

          // return in common format
          response = {code: 0, message: 'ok', data: data || null};
        } catch (err) {
          const errCaused = err as ErrorCaused
          // convert all errors to http errors
          if (createHTTPError.isHttpError(err)) {
            // pass http errors thrown by handler forward
            throw err;
          } else if (errCaused.name === 'apierror') {
            // parameters were wrong and the api stopped execution, pass the error
            // convert to http error
            throw new createHTTPError.BadRequest(errCaused.message);
          } else {
            // an unknown error happened
            // log it and throw internal error
            console.error(errCaused.stack || errCaused.toString());
            throw new createHTTPError.InternalServerError('internal error');
          }
        }
      } catch (err) {
        const errCaused = err as ErrorCaused
        // handle http errors
        // @ts-ignore
        res.statusCode = errCaused.statusCode || 500;

        // convert to our json response format
        // https://github.com/ether/etherpad-lite/tree/master/doc/api/http_api.md#response-format
        switch (res.statusCode) {
          case 403: // forbidden
            response = {code: 4, message: errCaused.message, data: null};
            break;
          case 401: // unauthorized (no or wrong api key)
            response = {code: 4, message: errCaused.message, data: null};
            break;
          case 404: // not found (no such function)
            response = {code: 3, message: errCaused.message, data: null};
            break;
          case 500: // server error (internal error)
            response = {code: 2, message: errCaused.message, data: null};
            break;
          case 400: // bad request (wrong parameters)
            // respond with 200 OK to keep old behavior and pass tests
            res.statusCode = 200; // @TODO: this is bad api design
            response = {code: 1, message: errCaused.message, data: null};
            break;
          default:
            response = {code: 1, message: errCaused.message, data: null};
            break;
        }
      }


      console.debug(`RESPONSE, ${functionName}, ${JSON.stringify(response)}`);

      // return the response data
      res.json(response);
    } else {
      res.json({code: 1, message: 'not found'});
    }
  })
}
