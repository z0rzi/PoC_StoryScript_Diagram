const fs = require('fs');
const http = require('http');
var path = require('path');

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

class DiagramComponent {

    id = 0
    html = ""
    innerComponents = []
    opener = ""
    closer = ""

    constructor(id0, obj) {
        this.id = id0

        switch(obj.method) {
            case "function":
                this.html =`<div class="component function"><img class="icon" src="./assets/functionIcon.png" />${obj.function}</div>`;
                this.opener = "<div class='block'>";
                this.closer = "</div>";
                break;
            case "return":
                this.html =`<div class="component return">${parser.parseArgs(obj.args[0])}</div>`;
                break;
            case "call":
                this.html =`<div class="component variable">${obj.name[0]}</div>`;
                break;
            case "execute":
                this.html =`<div class="component execute">&lt;${obj.service}&gt; ${obj.command}</div>`;
                break;
            case "if":
                this.html =`<div class="component if">If ${parser.parseArgs(obj.args[0])}</div>`;
                this.opener = "<div class='block'>";
                this.closer = "</div>";
                break;
            case "else":
                this.html =`<div class="component else">else</div>`;
                this.opener = "<div class='block'>";
                this.closer = "</div>";
                break;
        }

        // console.log(this.html);
    }

    /** 
     * Adds other components to the body, only usefull for the components that
     * have a body (e.g. function, when, if ...)
     */
    addToBody( component ) {
        this.innerComponents.push(component);
    }

    getHTML() {
        return this.html +
            this.opener + 
            this.innerComponents.reduce((acc, cmp) => acc+cmp.getHTML(), "")+
            this.closer;
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

    parseTree(fullTree, pointer, parent=null, level=0) {

        while( !!pointer ) {

            console.log(level)

            let currentLine = fullTree[pointer]

            let comp = new DiagramComponent(pointer, currentLine)

            if( level === 0 )
                this.components.push(comp);
            else
                parent.addToBody(comp);

            if( !!currentLine.enter ) {
                this.parseTree(fullTree, currentLine.enter, comp, level+1)
            }

            pointer = currentLine.next
        }
    }

    toHTML() {
        return this.components.reduce((acc, cmp) => acc+cmp.getHTML(), "")
    }
}

fs.readFile("example.json", {encoding: 'utf-8'}, function(err, rawTree){
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

        http.createServer(function(request, response) {  



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
        }).listen(8000);

    });
});
