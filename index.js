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
    "list": "assets/typeList.png"
}

const base_icons = {
    "function": "assets/functionIcon.png",
    "return": "assets/returnIcon.png",
    "loop": "assets/loopIcon.png",
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
    iconsSrc   = {}
    innerVariables = {}
    innerText = ""
    type = ""

    innerComponents = []

    constructor(obj) {

        //
        // Those are displayed as variables, so we switch the method
        //
        if(obj.method == "expression") {
            obj = { "method": "variable", "name": obj.name[0], "type": obj.args[0]["$OBJECT"] }
        } else if(obj.method == "call") {
            obj = { "method": "variable", "name": obj.name[0], "type": undefined }
        }

        this.type = obj.method;

        switch(obj.method) {
            case "variable":
                this.classes.push("variable");
                this.innerText = "::main::" + obj.name;

                if( !obj.type && "function" in obj ) {
                    // It's a function call, but the function hasn't been defined yet...
                    let called_function = obj["function"]
                    findFuncReturnType(called_function, type => {
                        this.iconsSrc["main"] = type_icon[type] || type_icon["default"];
                    })
                } else {
                    this.iconsSrc["main"] = type_icon[obj.type] || type_icon["default"];
                }
                break;
            case "function":
                this.classes.push("function")
                this.innerText = "::main::" + obj.function;
                this.iconsSrc["main"] = base_icons["function"]
                registerNewFunction( obj["function"], obj["output"][0] )
                break;
            case "return":
                this.classes.push("return")
                this.innerText = "::main::" + parser.parseArgs(obj.args[0]);
                this.iconsSrc["main"] = base_icons["return"]
                break;
            case "execute":
                if( obj.output.length ) {
                    // Means it initialize a variable!
                    this.classes.push("variable");
                    this.innerText = "::main::" + obj.output[0];
                    // Unable to know the type for now...
                    this.iconsSrc["main"] = type_icon["default"];
                } else {
                    this.classes.push("execute");
                    this.innerText = "::main::" + obj.command;
                    this.iconsSrc["main"] = service_icon[obj.service] || service_icon["default"];
                }
                break;
            case "if":
                this.classes.push("if");
                this.innerText = `If ${parser.parseArgs(obj.args[0])}:`;
                break;
            case "else":
                this.classes.push("else");
                this.innerText = `Else:`;
                break;
            case "when":
                this.classes.push("when");
                this.innerText = `When ::main:: ${obj.command}<br/>@@output@@`;

                this.innerVariables["output"] = new DiagramComponent({ "method": "variable", "name": obj.output[0], "type": undefined })
                this.iconsSrc["main"] = service_icon[obj.service] || service_icon["default"];
                break;
            case "for":
                this.classes.push("for");
                this.innerText = `Loop through ::main:: @@loopFeed@@`
                this.innerText += `<br/>@@output@@`;
                // this.iconsSrc["var"] = type_icon["default"];
                this.innerVariables["output"] = new DiagramComponent({ "method": "variable", "name": obj.output[0], "type": undefined })
                this.innerVariables["loopFeed"] = new DiagramComponent({ "method": "variable", "name": parser.parseArgs(obj.args[0]), "type": undefined })
                break;
        }
    }

    /** 
     * Adds other components to the body, only usefull for the components that
     * have a body (e.g. function, when, if ...)
     */
    addToBody( component ) {
        if( ["for", "when", "if", "else"].includes(this.type) ) {
            // Doesn't make sense otherwise...
            this.innerComponents.push(component);
            return true;
        }
        return false;
    }

    getHTML() {
        this.innerText = this.innerText
            .replace(/::\w+::/g, match => {
                match = match.replace(/:/g, "");

                if( match in this.iconsSrc )
                    return `<img class="icon" src="${this.iconsSrc[match]}" />`
                else
                    return ""
            }).replace(/@@\w+@@/g, match => {
                match = match.replace(/@/g, "");

                if( match in this.innerVariables )
                    return this.innerVariables[match].getHTML()
                else
                    return ""
            })

        let out = `<div class="${this.classes.join(' ')}">${this.innerText}</div>`

        if( !!this.innerComponents.length ) {
            console.log(this.innerText);
            console.log(this.innerComponents);
            out += `<div class="block">`;
            out += this.innerComponents.reduce((acc, cmp) => acc+cmp.getHTML(), "");
            out += `</div>`;
        }

        return out;
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

            let status = false;
            if( parent !== null ) // root level
                status = parent.addToBody(comp)
            if( !status )
                this.components.push(comp);

            if( !!currentLine.enter ) {
                let status = this.parseTree(fullTree, currentLine.enter, comp)
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
