'use strict';
/**
 * The CLI module handles command line parameters
 */

/*
 * 2012 Jordan Hollinger
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an
  "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// An object containing the parsed command-line options

export const argv: Record<string, string> = {};

const argvInternal = process.argv.slice(2);
let arg, prevArg = "";

// Loop through args
for (let i = 0; i < argvInternal.length; i++) {
  arg = argvInternal[i];

  // Override location of settings.json file
  if (prevArg && prevArg === '--settings' || prevArg === '-s') {
    console.log("Using specified settings from command line");
    argv.settings = arg;
  }

  // Override location of credentials.json file
  if (prevArg && prevArg === '--credentials') {
    console.log("Using specified credentials from command line");
    argv.credentials = arg;
  }

  // Override location of settings.json file
  if (prevArg && prevArg === '--sessionkey') {
    console.log("Using specified session key from command line");
    argv.sessionkey = arg;
  }

  // Override location of APIKEY.txt file
  if (prevArg && prevArg === '--apikey') {
    console.log("Using specified API key from command line");
    argv.apikey = arg;
  }

  prevArg = arg;
}
