const fs = require('fs'),
      http = require('http'),
      path = require('path');

const PORT = 8000

const service_icon = {
    "stripe": "assets/serviceStripe.png",
    "psql": "assets/servicePostgre.png",
    "mailgun": "assets/serviceMailgun.png",
    "redis": "assets/serviceRedis.png",
    "http": "assets/serviceHttp.png",
    "default": "assets/serviceUnknown.png"
}

const type_icon = {
    "string": "assets/typeText.png",
    "default": "assets/typeDefault.png",
    "boolean": "assets/typeBoolean.png",
    "List": "assets/typeList.png"
}

const base_icons = {
    "function": "assets/functionIcon.png",
    "return": "assets/returnIcon.png",
    "for": "assets/loopIcon.png",
    "while": "assets/loopIcon.png",
}

const parser = {
    parseArgs: arg => {
        switch( arg["$OBJECT"] ) {
            case "path":
                var out = arg.paths[0];
                out += arg.paths.slice(1).reduce((acc,val) => acc + '[' + parser.parseArgs(val) + ']',"")
                return out;

            case "expression":
                var sign = {
                    "sum": "+",
                    "multiplication": "*"
                }[arg.expression] || arg.expression

                return parser.parseArgs(arg.values[0]) +" "+ sign +" "+ parser.parseArgs(arg.values[1])

            case "list":
                var out = arg.items.map(val => parser.parseArgs(val)).join(", ")
                return `[${out}]`

            case "arg":
                return arg.name + ": " + parser.parseArgs(arg.arg)

            case "int":
                return arg.int

            case "string":
                return `"${arg.string}"`

            case "type":
                return `<${arg.type}>`

            default:
                return arg[ arg["$OBJECT"] ]
        }
    }
}

//
// Bellow functions used to asynchronously add type to variables for the "call" method
//  ⤷ The call method doesn't give the var type, so we have to wait until the
//    function is defined to retrieve the variable type
//
var waiting_vars = {};
var defined_funcs = {};

function registerNewFunction(func_name, return_type) {
    defined_funcs[func_name] = return_type;

    if( func_name in waiting_vars ) {
        waiting_vars[func_name].forEach( callback => callback( return_type ) )
    }
}

function findFuncReturnType(func_name, callback) {
    if( func_name in defined_funcs ) {
        callback(defined_funcs[func_name]);
    } else {
        if( func_name in waiting_vars ) {
            waiting_vars[func_name].push(callback);
        } else {
            waiting_vars[func_name] = [ callback ];
        }
    }
}

class DiagramComponent {

    html      = ""
    classes   = ["component"]
    iconSrc   = ""
    innerText = ""

    innerComponents = []
    header = ""
    footer = ""

    constructor(obj) {

        switch(obj.method) {
            case "function":
                this.classes.push("function")
                this.innerText = obj.function;
                this.imageSrc = base_icons["function"]
                this.header = "<div class='block'>";
                this.footer = "</div>";
                registerNewFunction( obj["function"], obj["output"][0] )
                break;
            case "return":
                this.classes.push("return")
                this.innerText = parser.parseArgs(obj.args[0]);
                this.imageSrc = base_icons["return"]
                break;
            case "expression":
                this.classes.push("variable");
                this.innerText = obj.name[0];
                let type = obj.args[0]["$OBJECT"];
                this.imageSrc = type_icon[type] || type_icon["default"];
                break;
            case "call":
                this.classes.push("variable")
                this.innerText = obj.name[0];

                let called_function = obj["function"]
                findFuncReturnType(called_function, type => {
                    this.imageSrc = type_icon[type] || type_icon["default"];
                })
                break;
            case "execute":
                this.classes.push("execute");
                this.innerText = obj.command;
                this.imageSrc = service_icon[obj.service] || service_icon["default"];
                break;
            case "if":
                this.classes.push("if");
                this.innerText = `If ${parser.parseArgs(obj.args[0])}:`;
                this.header = "<div class='block'>";
                this.footer = "</div>";
                break;
            case "else":
                this.classes.push("else");
                this.innerText = `Else:`;
                this.header = "<div class='block'>";
                this.footer = "</div>";
                break;
            case "when":
                this.classes.push("else");
                this.innerText = `When ::ICON:: ${obj.command}`;
                this.header = "<div class='block'>";
                this.footer = "</div>";
                break;
        }
    }

    /** 
     * Adds other components to the body, only usefull for the components that
     * have a body (e.g. function, when, if ...)
     */
    addToBody( component ) {
        this.innerComponents.push(component);
    }

    getHTML() {
        let img = ""
        if( !!this.imageSrc ) img = `<img class="icon" src="${this.imageSrc}" />`

        let compHtml = `<div class="${this.classes.join(' ')}">${img} ${this.innerText}</div>`

        return compHtml +
            this.header + 
            this.innerComponents.reduce((acc, cmp) => acc+cmp.getHTML(), "")+
            this.footer;
    }
}

class Diagram {

    components = []

    constructor(compiled) {
        let pointer = compiled.entrypoint

        compiled = compiled.stories[pointer]
        pointer = compiled.entrypoint
        compiled = compiled.tree

        this.parseTree(compiled, pointer)
    }

    parseTree(fullTree, pointer, parent=null) {

        while( !!pointer ) {

            let currentLine = fullTree[pointer]

            let comp = new DiagramComponent(currentLine)

            if( parent === null )
                this.components.push(comp);
            else
                parent.addToBody(comp);

            if( !!currentLine.enter ) {
                this.parseTree(fullTree, currentLine.enter, comp)
            }

            pointer = currentLine.next
        }
    }

    toHTML() {
        return this.components.reduce((acc, cmp) => acc+cmp.getHTML(), "")
    }
}


//
// Reading external files and launching server
//
fs.readFile("example2.json", {encoding: 'utf-8'}, function(err, rawTree){
    if(!!err) {
        console.log(err);
        return;
    }

    let compiled = JSON.parse(rawTree);

    fs.readFile("style.css", {encoding: 'utf-8'}, function(err, rawStyle){
        if(!!err) {
            console.log(err);
            return;
        }

        let d = new Diagram(compiled)

        console.log(`Listening on http://localhost:${PORT}`)

        http.createServer(function(request, response) {  

            //
            // Bellow code to access the images
            //
            var reqpath = request.url.toString().split('?')[0];
            var dir = __dirname;
            var file = path.join(dir, reqpath.replace(/\/$/, '/index.html'));
            var type = 'image/png';
            var s = fs.createReadStream(file);
            s.on('open', function () {
                response.setHeader('Content-Type', type);
                s.pipe(response);
            });
            s.on('error', function () {
                response.writeHeader(200, {"Content-Type": "text/html"});  
                response.write(d.toHTML());  
                response.write(`<style>${rawStyle}</style>`);
                response.end();  
            });
        }).listen(PORT);

    });
});
