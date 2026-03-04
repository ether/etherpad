export const cleanComments = (json: string|undefined)=>{
    if (json !== undefined){
        json = json.replace(/\/\*.*?\*\//g, "");          // remove single line comments
        json = json.replace(/ *\/\*.*(.|\n)*?\*\//g, ""); // remove multi line comments
        json = json.replace(/[ \t]+$/gm, "");             // trim trailing spaces
        json = json.replace(/^(\n)/gm, "");               // remove empty lines
    }
    return json;
}

export const minify = (json: string)=>{
    let tokenizer = /"|(\/\*)|(\*\/)|(\/\/)|\n|\r/g,
        in_string = false,
        in_multiline_comment = false,
        in_singleline_comment = false,
        tmp, tmp2, new_str = [], ns = 0, from = 0, lc, rc
    ;

    tokenizer.lastIndex = 0;

    while (tmp = tokenizer.exec(json)) {
        lc = RegExp.leftContext;
        rc = RegExp.rightContext;
        if (!in_multiline_comment && !in_singleline_comment) {
            tmp2 = lc.substring(from);
            if (!in_string) {
                tmp2 = tmp2.replace(/(\n|\r|\s)*/g,"");
            }
            new_str[ns++] = tmp2;
        }
        from = tokenizer.lastIndex;

        if (tmp[0] == "\"" && !in_multiline_comment && !in_singleline_comment) {
            tmp2 = lc.match(/(\\)*$/);
            if (!in_string || !tmp2 || (tmp2[0].length % 2) == 0) {	// start of string with ", or unescaped " character found to end string
                in_string = !in_string;
            }
            from--; // include " character in next catch
            rc = json.substring(from);
        }
        else if (tmp[0] == "/*" && !in_string && !in_multiline_comment && !in_singleline_comment) {
            in_multiline_comment = true;
        }
        else if (tmp[0] == "*/" && !in_string && in_multiline_comment && !in_singleline_comment) {
            in_multiline_comment = false;
        }
        else if (tmp[0] == "//" && !in_string && !in_multiline_comment && !in_singleline_comment) {
            in_singleline_comment = true;
        }
        else if ((tmp[0] == "\n" || tmp[0] == "\r") && !in_string && !in_multiline_comment && in_singleline_comment) {
            in_singleline_comment = false;
        }
        else if (!in_multiline_comment && !in_singleline_comment && !(/\n|\r|\s/.test(tmp[0]))) {
            new_str[ns++] = tmp[0];
        }
    }
    new_str[ns++] = rc;
    return new_str.join("");
}

export const isJSONClean = (data: string) => {
    let cleanSettings = minify(data);
    // this is a bit naive. In theory some key/value might contain the sequences ',]' or ',}'
    cleanSettings = cleanSettings.replace(',]', ']').replace(',}', '}');
    try {
        return typeof JSON.parse(cleanSettings) === 'object';
    } catch (e) {
        return false; // the JSON failed to be parsed
    }
};
