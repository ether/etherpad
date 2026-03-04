export type PackageInfo =  {
    from: string,
    name: string,
    version: string,
    resolved: string,
    description: string,
    license: string,
    author: {
        name: string
    },
    homepage: string,
    repository: string,
    path: string
}


export type PackageData = {
    version: string,
    name: string
}