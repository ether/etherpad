import {exec} from 'child_process'
import fs from 'fs'
import path from 'path'

import pjson from '../src/package.json'

const VERSION=pjson.version
console.log(`Building docs for version ${VERSION}`)

const createDirIfNotExists = (dir: fs.PathLike) => {
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir)
    }
}


function copyFolderSync(from: fs.PathLike, to: fs.PathLike) {
    if(fs.existsSync(to)){
        const stat = fs.lstatSync(to)
        if (stat.isDirectory()){
            fs.rmSync(to, { recursive: true })
        }
        else{
            fs.rmSync(to)
        }
    }
    fs.mkdirSync(to);
    fs.readdirSync(from).forEach(element => {
        if (fs.lstatSync(path.join(<string>from, element)).isFile()) {
          if (typeof from === "string") {
            if (typeof to === "string") {
              fs.copyFileSync(path.join(from, element), path.join(to, element))
            }
          }
        } else {
          if (typeof from === "string") {
            if (typeof to === "string") {
              copyFolderSync(path.join(from, element), path.join(to, element))
            }
          }
        }
    });
}

exec('asciidoctor -v', (err,stdout)=>{
    if (err){
        console.log('Please install asciidoctor')
        console.log('https://asciidoctor.org/docs/install-toolchain/')
        process.exit(1)
    }
});


createDirIfNotExists('../out')
createDirIfNotExists('../out/doc')
createDirIfNotExists('../out/doc/api')



exec(`asciidoctor -D ../out/doc ../doc/index.adoc ../*/**.adoc -a VERSION=${VERSION}`)
exec(`asciidoctor -D ../out/doc/api  ../doc/api/*.adoc -a VERSION=${VERSION}`)

copyFolderSync('../doc/public/', '../out/doc/')
