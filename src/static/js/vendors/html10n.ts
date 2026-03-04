import {Func} from "mocha";


type PluralFunc = (n: number) => string

export class Html10n {
  public language?: string
  private rtl: string[]
  private _pluralRules?: PluralFunc
  public mt: MicroEvent
  private loader: Loader | undefined
  public translations: Map<string, any>
  private macros: Map<string, Function>

  constructor() {
    this.language = undefined
    this.rtl = ["ar","dv","fa","ha","he","ks","ku","ps","ur","yi"]
    this.mt = new MicroEvent()
    this.translations = new Map()
    this.macros = new Map()

    this.macros.set('plural', (_key: string, param:string, opts: any)=>{
      let str
        , n = parseFloat(param);
      if (isNaN(n))
        return;

      // initialize _pluralRules
      if (this._pluralRules === undefined) {
        this._pluralRules = this.getPluralRules(this.language!);
      }
      let index = this._pluralRules!(n);

      // try to find a [zero|one|two] key if it's defined
      if (n === 0 && ('zero') in opts) {
        str = opts['zero'];
      } else if (n == 1 && ('one') in opts) {
        str = opts['one'];
      } else if (n == 2 && ('two') in opts) {
        str = opts['two'];
      } else if (index in opts) {
        str = opts[index];
      }

      return str;
    })

    document.addEventListener('DOMContentLoaded', ()=> {
        this.index()
      }, false)
  }

  bind(event: string, fct: Func) {
    this.mt.bind(event, fct)
  }

  /**
   * Get rules for plural forms (shared with JetPack), see:
   * http://unicode.org/repos/cldr-tmp/trunk/diff/supplemental/language_plural_rules.html
   * https://github.com/mozilla/addon-sdk/blob/master/python-lib/plural-rules-generator.p
   *
   * @param {string} lang
   *    locale (language) used.
   *
   * @return {PluralFunc}
   *    returns a function that gives the plural form name for a given integer:
   *       var fun = getPluralRules('en');
   *       fun(1)    -> 'one'
   *       fun(0)    -> 'other'
   *       fun(1000) -> 'other'.
   */
  getPluralRules(lang: string): PluralFunc {
    const locales2rules = new Map([
      ['af', 3],
      ['ak', 4],
      ['am', 4],
      ['ar', 1],
      ['asa', 3],
      ['az', 0],
      ['be', 11],
      ['bem', 3],
      ['bez', 3],
      ['bg', 3],
      ['bh', 4],
      ['bm', 0],
      ['bn', 3],
      ['bo', 0],
      ['br', 20],
      ['brx', 3],
      ['bs', 11],
      ['ca', 3],
      ['cgg', 3],
      ['chr', 3],
      ['cs', 12],
      ['cy', 17],
      ['da', 3],
      ['de', 3],
      ['dv', 3],
      ['dz', 0],
      ['ee', 3],
      ['el', 3],
      ['en', 3],
      ['eo', 3],
      ['es', 3],
      ['et', 3],
      ['eu', 3],
      ['fa', 0],
      ['ff', 5],
      ['fi', 3],
      ['fil', 4],
      ['fo', 3],
      ['fr', 5],
      ['fur', 3],
      ['fy', 3],
      ['ga', 8],
      ['gd', 24],
      ['gl', 3],
      ['gsw', 3],
      ['gu', 3],
      ['guw', 4],
      ['gv', 23],
      ['ha', 3],
      ['haw', 3],
      ['he', 2],
      ['hi', 4],
      ['hr', 11],
      ['hu', 0],
      ['id', 0],
      ['ig', 0],
      ['ii', 0],
      ['is', 3],
      ['it', 3],
      ['iu', 7],
      ['ja', 0],
      ['jmc', 3],
      ['jv', 0],
      ['ka', 0],
      ['kab', 5],
      ['kaj', 3],
      ['kcg', 3],
      ['kde', 0],
      ['kea', 0],
      ['kk', 3],
      ['kl', 3],
      ['km', 0],
      ['kn', 0],
      ['ko', 0],
      ['ksb', 3],
      ['ksh', 21],
      ['ku', 3],
      ['kw', 7],
      ['lag', 18],
      ['lb', 3],
      ['lg', 3],
      ['ln', 4],
      ['lo', 0],
      ['lt', 10],
      ['lv', 6],
      ['mas', 3],
      ['mg', 4],
      ['mk', 16],
      ['ml', 3],
      ['mn', 3],
      ['mo', 9],
      ['mr', 3],
      ['ms', 0],
      ['mt', 15],
      ['my', 0],
      ['nah', 3],
      ['naq', 7],
      ['nb', 3],
      ['nd', 3],
      ['ne', 3],
      ['nl', 3],
      ['nn', 3],
      ['no', 3],
      ['nr', 3],
      ['nso', 4],
      ['ny', 3],
      ['nyn', 3],
      ['om', 3],
      ['or', 3],
      ['pa', 3],
      ['pap', 3],
      ['pl', 13],
      ['ps', 3],
      ['pt', 3],
      ['rm', 3],
      ['ro', 9],
      ['rof', 3],
      ['ru', 11],
      ['rwk', 3],
      ['sah', 0],
      ['saq', 3],
      ['se', 7],
      ['seh', 3],
      ['ses', 0],
      ['sg', 0],
      ['sh', 11],
      ['shi', 19],
      ['sk', 12],
      ['sl', 14],
      ['sma', 7],
      ['smi', 7],
      ['smj', 7],
      ['smn', 7],
      ['sms', 7],
      ['sn', 3],
      ['so', 3],
      ['sq', 3],
      ['sr', 11],
      ['ss', 3],
      ['ssy', 3],
      ['st', 3],
      ['sv', 3],
      ['sw', 3],
      ['syr', 3],
      ['ta', 3],
      ['te', 3],
      ['teo', 3],
      ['th', 0],
      ['ti', 4],
      ['tig', 3],
      ['tk', 3],
      ['tl', 4],
      ['tn', 3],
      ['to', 0],
      ['tr', 0],
      ['ts', 3],
      ['tzm', 22],
      ['uk', 11],
      ['ur', 3],
      ['ve', 3],
      ['vi', 0],
      ['vun', 3],
      ['wa', 4],
      ['wae', 3],
      ['wo', 0],
      ['xh', 3],
      ['xog', 3],
      ['yo', 0],
      ['zh', 0],
      ['zu', 3]
    ])

    function isIn(n: number, list: number[]) {
      return list.indexOf(n) !== -1;
    }
    function isBetween(n: number, start: number, end: number) {
      return start <= n && n <= end;
    }

    type PluralFunc = (n: number) => string


    const pluralRules: {
      [key: string]: PluralFunc
    } =  {
      '0': function() {
        return 'other';
      },
      '1': function(n: number) {
        if ((isBetween((n % 100), 3, 10)))
          return 'few';
        if (n === 0)
          return 'zero';
        if ((isBetween((n % 100), 11, 99)))
          return 'many';
        if (n == 2)
          return 'two';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '2': function(n: number) {
        if (n !== 0 && (n % 10) === 0)
          return 'many';
        if (n == 2)
          return 'two';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '3': function(n: number) {
        if (n == 1)
          return 'one';
        return 'other';
      },
      '4': function(n: number) {
        if ((isBetween(n, 0, 1)))
          return 'one';
        return 'other';
      },
      '5': function(n: number) {
        if ((isBetween(n, 0, 2)) && n != 2)
          return 'one';
        return 'other';
      },
      '6': function(n: number) {
        if (n === 0)
          return 'zero';
        if ((n % 10) == 1 && (n % 100) != 11)
          return 'one';
        return 'other';
      },
      '7': function(n: number) {
        if (n == 2)
          return 'two';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '8': function(n: number) {
        if ((isBetween(n, 3, 6)))
          return 'few';
        if ((isBetween(n, 7, 10)))
          return 'many';
        if (n == 2)
          return 'two';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '9': function(n: number) {
        if (n === 0 || n != 1 && (isBetween((n % 100), 1, 19)))
          return 'few';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '10': function(n: number) {
        if ((isBetween((n % 10), 2, 9)) && !(isBetween((n % 100), 11, 19)))
          return 'few';
        if ((n % 10) == 1 && !(isBetween((n % 100), 11, 19)))
          return 'one';
        return 'other';
      },
      '11': function(n: number) {
        if ((isBetween((n % 10), 2, 4)) && !(isBetween((n % 100), 12, 14)))
          return 'few';
        if ((n % 10) === 0 ||
          (isBetween((n % 10), 5, 9)) ||
          (isBetween((n % 100), 11, 14)))
          return 'many';
        if ((n % 10) == 1 && (n % 100) != 11)
          return 'one';
        return 'other';
      },
      '12': function(n: number) {
        if ((isBetween(n, 2, 4)))
          return 'few';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '13': function(n: number) {
        if ((isBetween((n % 10), 2, 4)) && !(isBetween((n % 100), 12, 14)))
          return 'few';
        if (n != 1 && (isBetween((n % 10), 0, 1)) ||
          (isBetween((n % 10), 5, 9)) ||
          (isBetween((n % 100), 12, 14)))
          return 'many';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '14': function(n: number) {
        if ((isBetween((n % 100), 3, 4)))
          return 'few';
        if ((n % 100) == 2)
          return 'two';
        if ((n % 100) == 1)
          return 'one';
        return 'other';
      },
      '15': function(n: number) {
        if (n === 0 || (isBetween((n % 100), 2, 10)))
          return 'few';
        if ((isBetween((n % 100), 11, 19)))
          return 'many';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '16': function(n: number) {
        if ((n % 10) == 1 && n != 11)
          return 'one';
        return 'other';
      },
      '17': function(n: number) {
        if (n == 3)
          return 'few';
        if (n === 0)
          return 'zero';
        if (n == 6)
          return 'many';
        if (n == 2)
          return 'two';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '18': function(n: number) {
        if (n === 0)
          return 'zero';
        if ((isBetween(n, 0, 2)) && n !== 0 && n != 2)
          return 'one';
        return 'other';
      },
      '19': function(n: number) {
        if ((isBetween(n, 2, 10)))
          return 'few';
        if ((isBetween(n, 0, 1)))
          return 'one';
        return 'other';
      },
      '20': function(n: number) {
        if ((isBetween((n % 10), 3, 4) || ((n % 10) == 9)) && !(
          isBetween((n % 100), 10, 19) ||
          isBetween((n % 100), 70, 79) ||
          isBetween((n % 100), 90, 99)
        ))
          return 'few';
        if ((n % 1000000) === 0 && n !== 0)
          return 'many';
        if ((n % 10) == 2 && !isIn((n % 100), [12, 72, 92]))
          return 'two';
        if ((n % 10) == 1 && !isIn((n % 100), [11, 71, 91]))
          return 'one';
        return 'other';
      },
      '21': function(n: number) {
        if (n === 0)
          return 'zero';
        if (n == 1)
          return 'one';
        return 'other';
      },
      '22': function(n: number) {
        if ((isBetween(n, 0, 1)) || (isBetween(n, 11, 99)))
          return 'one';
        return 'other';
      },
      '23': function(n: number) {
        if ((isBetween((n % 10), 1, 2)) || (n % 20) === 0)
          return 'one';
        return 'other';
      },
      '24': function(n: number) {
        if ((isBetween(n, 3, 10) || isBetween(n, 13, 19)))
          return 'few';
        if (isIn(n, [2, 12]))
          return 'two';
        if (isIn(n, [1, 11]))
          return 'one';
        return 'other';
      }
    };

    const index = locales2rules.get(lang.replace(/-.*$/, ''));
    // @ts-ignore
    if (!(index in pluralRules)) {
      console.warn('plural form unknown for [' + lang + ']');
      return function() { return 'other'; };
    }
    // @ts-ignore
    return pluralRules[index];
  }

  getTranslatableChildren(element: HTMLElement) {
    return element.querySelectorAll('*[data-l10n-id]')
  }

  localize(langs: (string|undefined)[]|string) {
    if ('string' === typeof langs) {
      langs = [langs];
    }
    let i = 0
    langs.forEach((lang) => {
      if(!lang) return;
      langs[i++] = lang;
      if(~lang.indexOf('-')) langs[i++] = lang.substring(0, lang.indexOf('-'));
    })

    this.build(langs, (er: null, translations: Map<string, any>) =>{
      this.translations = translations
      this.translateElement(translations)
      this.mt.trigger('localized')
    })
  }

  /**
   * Triggers the translation process
   * for an element
   * @param translations A hash of all translation strings
   * @param element A DOM element, if omitted, the document element will be used
   */
  translateElement(translations: Map<string, any>, element?: HTMLElement) {
    element = element || document.documentElement
    const children = element ? this.getTranslatableChildren(element): document.childNodes

    for (let child of children) {
      this.translateNode(translations, child as HTMLElement)
    }

    // translate element itself if necessary
    this.translateNode(translations, element)
  }

   asyncForEach(list: (string|undefined)[], iterator: any, cb: Function) {
    let i = 0
      , n = list.length
    iterator(list[i], i, function each(err?: string) {
      if(err) console.error(err)
      i++
      if (i < n) return iterator(list[i],i, each);
      cb()
    })
  }

  /**
   * Builds a translation object from a list of langs (loads the necessary translations)
   * @param langs Array - a list of langs sorted by priority (default langs should go last)
   * @param cb Function - a callback that will be called once all langs have been loaded
   */
  build(langs: (string|undefined)[], cb: Function) {
    const build = new Map<string, any>()

    this.asyncForEach(langs,  (lang: string, _i: number, next:LoaderFunc)=> {
      if(!lang) return next();
      this.loader!.load(lang, next)
    }, () =>{
      let lang;
      langs.reverse()

      // loop through the priority array...
      for (let i=0, n=langs.length; i < n; i++) {
        lang = langs[i]
        if(!lang) continue;
        if(!langs.includes(lang)) {// uh, we don't have this lang availbable..
          // then check for related langs
          if(~lang.indexOf('-') != -1) {
            lang = lang.split('-')[0];
          }
          let l: string|undefined = ''
          for(l of langs) {
            if(l && lang != l && l.indexOf(lang) === 0) {
              lang = l
              break;
            }
          }

          // @ts-ignore
          if(lang != l) continue;
        }


        // ... and apply all strings of the current lang in the list
        // to our build object
        //lang = "de"
        if (this.loader!.langs.has(lang)) {
          for (let string in this.loader!.langs.get(lang)) {
            build.set(string,this.loader!.langs.get(lang)[string])
          }
          this.language = lang
        } else {
          const loaderLang = lang.split('-')[0]
          for (let string in this.loader!.langs.get(loaderLang)) {
            build.set(string,this.loader!.langs.get(loaderLang)[string])
          }
          this.language = loaderLang
        }

        // the last applied lang will be exposed as the
        // lang the page was translated to
      }
      cb(null, build)
    })
  }

  /**
   * Returns the language that was last applied to the translations hash
   * thus overriding most of the formerly applied langs
   */
  getLanguage() {
    return this.language
  }

  /**
   * Returns the direction of the language returned be html10n#getLanguage
   */
  getDirection() {
    if(!this.language) return
    const langCode = this.language.indexOf('-') == -1? this.language : this.language.substring(0, this.language.indexOf('-'))
    return this.rtl.indexOf(langCode) == -1? 'ltr' : 'rtl'
  }


  /**
   * Index all <link>s
   */
  index() {
    // Find all <link>s
    const links = document.getElementsByTagName('link')
      , resources = []
    for (let i=0, n=links.length; i < n; i++) {
      if (links[i].type != 'application/l10n+json')
        continue;
      resources.push(links[i].href)
    }
    this.loader = new Loader(resources)
    this.mt.trigger('indexed')
  }

  translateNode(translations: Map<string, any>, node: HTMLElement) {
    const str: {
      id?: string,
      args?: any,
      str?: string

    } = {}

    // get id
    str.id = node.getAttribute('data-l10n-id') as string
    if (!str.id) return

    if(!translations.get(str.id)) return console.warn('Couldn\'t find translation key '+str.id)

    // get args
    if(window.JSON) {
      str.args = JSON.parse(node.getAttribute('data-l10n-args') as string)
    }else{
      try{
        //str.args = eval(node.getAttribute('data-l10n-args') as string)
        console.error("Old eval method invoked!!")
      }catch(e) {
        console.warn('Couldn\'t parse args for '+str.id)
      }
    }

    str.str = this.get(str.id, str.args)

    // get attribute name to apply str to
    let prop
      , index = str.id.lastIndexOf('.')
      , attrList = // allowed attributes
      { "title": 1
        , "innerHTML": 1
        , "alt": 1
        , "textContent": 1
        , "value": 1
        , "placeholder": 1
      }
    if (index > 0 && str.id.substring(index + 1) in attrList) {
      // an attribute has been specified (example: "my_translation_key.placeholder")
      prop = str.id.substring(index + 1)
    } else { // no attribute: assuming text content by default
      prop = document.body.textContent ? 'textContent' : 'innerText'
    }

    // Apply translation
    if (node.children.length === 0 || prop != 'textContent') {
      // @ts-ignore
      node[prop] = str.str!
      node.setAttribute("aria-label", str.str!); // Sets the aria-label
      // The idea of the above is that we always have an aria value
      // This might be a bit of an abrupt solution but let's see how it goes
    } else {
      let children = node.childNodes,
        found = false
      let i = 0, n = children.length;
      for (; i < n; i++) {
        if (children[i].nodeType === 3 && /\S/.test(children[i].textContent!)) {
          if (!found) {
            children[i].nodeValue = str.str!
            found = true
          } else {
            children[i].nodeValue = ''
          }
        }
      }
      if (!found) {
        console.warn('Unexpected error: could not translate element content for key '+str.id, node)
      }
    }
  }

  get(id: string, args?:any) {
    let translations = this.translations
    if(!translations) return console.warn('No translations available (yet)')
    if(!translations.get(id)) return console.warn('Could not find string '+id)

    // apply macros
    let str = translations.get(id)

    str = this.substMacros(id, str, args)

    // apply args
    str = this.substArguments(str, args)

    return str
  }

  substMacros(key: string, str:string, args:any) {
    let regex = /\{\[\s*([a-zA-Z]+)\(([a-zA-Z]+)\)((\s*([a-zA-Z]+)\: ?([ a-zA-Z{}]+),?)+)*\s*\]\}/ //.exec('{[ plural(n) other: are {{n}}, one: is ]}')
      , match

    while(match = regex.exec(str)) {
      // a macro has been found
      // Note: at the moment, only one parameter is supported
      let macroName = match[1]
        , paramName = match[2]
        , optv = match[3]
        , opts: {[key:string]:any} = {}

      if (!(this.macros.has(macroName))) continue

      if(optv) {
        optv.match(/(?=\s*)([a-zA-Z]+)\: ?([ a-zA-Z{}]+)(?=,?)/g)!.forEach(function(arg) {
          const parts = arg.split(':')
            , name = parts[0];
          opts[name] = parts[1].trim()
        })
      }

      let param
      if (args && paramName in args) {
        param = args[paramName]
      } else if (paramName in this.translations) {
        param = this.translations.get(paramName)
      }

      // there's no macro parser: it has to be defined in html10n.macros
      let macro = this.macros.get(macroName)!
      str = str.substring(0, match.index) + macro(key, param, opts) + str.substring(match.index+match[0].length)
    }

    return str
  }

  substArguments(str: string, args:any) {
    let reArgs = /\{\{\s*([a-zA-Z\.]+)\s*\}\}/
      , match
    let translations = this.translations;
    while (match = reArgs.exec(str)) {
      if (!match || match.length < 2)
        return str // argument key not found

      let arg = match[1]
        , sub = ''
      if (args && arg in args) {
        sub = args[arg]
      } else if (translations && arg in translations) {
        sub = translations.get(arg)
      } else {
        console.warn('Could not find argument {{' + arg + '}}')
        return str
      }

      str = str.substring(0, match.index) + sub + str.substring(match.index + match[0].length)
    }

    return str
  }

}


class MicroEvent {
  private events: Map<string, Function[]>

  constructor() {
    this.events = new Map();
  }

  bind(event: string, fct: Func) {
    if (this.events.get(event) === undefined) {
      this.events.set(event, []);
    }

    this.events.get(event)!.push(fct);
  }

  unbind(event: string, fct: Func) {
    if (this.events.get(event) === undefined) {
      return;
    }

    const index = this.events.get(event)!.indexOf(fct);
    if (index !== -1) {
      this.events.get(event)!.splice(index, 1);
    }
  }

  trigger(event: string, ...args: any[]) {
    if (this.events.get(event) === undefined) {
      return;
    }

    for (const fct of this.events.get(event)!) {
      fct(...args);
    }
  }

  mixin(destObject: any) {
    const props = ['bind', 'unbind', 'trigger'];
    if (destObject !== undefined) {
      for (const prop of props) {
        // @ts-ignore
        destObject[prop] = this[prop];
      }
    }
  }
}

type LoaderFunc = () => void

type ErrorFunc = (data?:any)=>void

class Loader {
  private resources: any
  private cache: Map<string, any>
  langs: Map<string, any>

  constructor(resources: any) {
    this.resources = resources;
    this.cache = new Map();
    this.langs = new Map();
  }

  load(lang: string, callback: LoaderFunc) {
    if (this.langs.get(lang) !== undefined) {
      callback();
      return;
    }

    if (this.resources.length > 0) {
      let reqs = 0
      for (const resource of this.resources) {
        this.fetch(resource, lang,  (e)=> {
          reqs++;
          if (e) console.warn(e)

          if (reqs < this.resources.length) return;// Call back once all reqs are completed
          callback && callback()
        })
      }
    }
  }

  fetch(href: string, lang: string, callback: ErrorFunc) {

    if (this.cache.get(href)) {
      this.parse(lang, href, this.cache.get(href), callback)
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('GET', href, /*async: */true)
    if (xhr.overrideMimeType) {
      xhr.overrideMimeType('application/json; charset=utf-8');
    }
    xhr.onreadystatechange = ()=> {
      if (xhr.readyState == 4) {
        if (xhr.status == 200 || xhr.status === 0) {
          const data = JSON.parse(xhr.responseText);
          this.cache.set(href, data)
          // Pass on the contents for parsing
          this.parse(lang, href, data, callback)
        } else {
          callback(new Error('Failed to load '+href))
        }
      }
    };
    xhr.send(null);
  }


  parse(lang: string, href: string, data: {
    [key: string]: string
  }, callback: ErrorFunc) {
    if ('object' !== typeof data) {
      callback(new Error('A file couldn\'t be parsed as json.'))
      return
    }

    function getBcp47LangCode(browserLang: string) {
      const bcp47Lang = browserLang.toLowerCase();

      // Browser => BCP 47
      const langCodeMap = new Map([
        ['zh-cn', 'zh-hans-cn'],
        ['zh-hk', 'zh-hant-hk'],
        ['zh-mo', 'zh-hant-mo'],
        ['zh-my', 'zh-hans-my'],
        ['zh-sg', 'zh-hans-sg'],
        ['zh-tw', 'zh-hant-tw'],
      ])

      return langCodeMap.get(bcp47Lang) ?? bcp47Lang;
    }

    // Issue #6129: Fix exceptions
    // NOTE: translatewiki.net use all lowercase form by default ('en-gb' insted of 'en-GB')
    function getJsonLangCode(bcp47Lang: string) {
      const jsonLang = bcp47Lang.toLowerCase();
      // BCP 47 => JSON
      const langCodeMap = new Map([
        ['sr-ec', 'sr-cyrl'],
        ['sr-el', 'sr-latn'],
        ['zh-hk', 'zh-hant-hk'],
      ])

      return langCodeMap.get(jsonLang) ?? jsonLang;
    }

    let bcp47LangCode = getBcp47LangCode(lang);
    let jsonLangCode = getJsonLangCode(bcp47LangCode);

    if (!data[jsonLangCode]) {
      // lang not found
      // This may be due to formatting (expected 'ru' but browser sent 'ru-RU')
      // Set err msg before mutating lang (we may need this later)
      const msg = 'Couldn\'t find translations for ' + lang +
        '(lowercase BCP 47 lang tag ' + bcp47LangCode +
        ', JSON lang code ' + jsonLangCode + ')';
      // Check for '-' (BCP 47 'ROOT-SCRIPT-REGION-VARIANT') and fallback until found data or ROOT
      // - 'ROOT-SCRIPT-REGION': 'zh-Hans-CN'
      // - 'ROOT-SCRIPT': 'zh-Hans'
      // - 'ROOT-REGION': 'en-GB'
      // - 'ROOT-VARIANT': 'be-tarask'
      while (!data[jsonLangCode] && bcp47LangCode.lastIndexOf('-') > -1) {
        // ROOT-SCRIPT-REGION-VARIANT formatting detected
        bcp47LangCode = bcp47LangCode.substring(0, bcp47LangCode.lastIndexOf('-')); // set lang to ROOT lang
        jsonLangCode = getJsonLangCode(bcp47LangCode);
      }

      if (!data[jsonLangCode]) {
        // ROOT lang not found. (e.g 'zh')
        // Loop through langs data. Maybe we have a variant? e.g (zh-hans)
        let l; // langs item. Declare outside of loop

        for (l in data) {
          // Is not ROOT?
          // And is variant of ROOT?
          // (NOTE: index of ROOT equals 0 would cause unexpected ISO 639-1 vs. 639-3 issues,
          // so append dash into query string)
          // And is known lang?
          if (bcp47LangCode != l && l.indexOf(lang + '-') === 0 && data[l]) {
            bcp47LangCode = l; // set lang to ROOT-SCRIPT (e.g 'zh-hans')
            jsonLangCode = getJsonLangCode(bcp47LangCode);
            break;
          }
        }

        // Did we find a variant? If not, return err.
        if (bcp47LangCode != l) {
          return callback(new Error(msg));
        }
      }
    }


    lang = jsonLangCode

    if('string' === typeof data[lang]) {
      // Import rule

      // absolute path
      let importUrl = data[lang];

      // relative path
      if(data[lang].indexOf("http") != 0 && data[lang].indexOf("/") != 0) {
        importUrl = href+"/../"+data[lang]
      }

      this.fetch(importUrl, lang, callback)
      return
    }

    if ('object' != typeof data[lang]) {
      callback(new Error('Translations should be specified as JSON objects!'))
      return
    }

    this.langs.set(lang,data[lang])
    // TODO: Also store accompanying langs
    callback()
  }
}

const html10n = new Html10n()
export default html10n

// @ts-ignore
window.html10n = html10n

// gettext-like shortcut
if (window._ === undefined){
  // @ts-ignore
  window._ = html10n.get;
}
