/** Local-only, real-input acceptance harness. Does not launch or emulate a GPU. */
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cpus, platform, release, totalmem } from 'node:os';

const root=resolve('.');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const identity=()=>({sha:git('rev-parse','HEAD'),dirty:git('status','--porcelain'),
  os:platform()+' '+release(),cpu:cpus()[0]?.model,memoryBytes:totalmem()});
const initial=identity();
if(initial.dirty) console.warn('Dirty checkout: evidence will be marked non-acceptance. Commit changes first.');
const server=await createServer({root,configFile:resolve(root,'vite.config.ts'),
  server:{host:'127.0.0.1',port:0,watch:null,hmr:false},plugins:[{
    name:'living-world-reference-device',
    configureServer(vite){
      vite.middlewares.use('/__living-world-qa-build',(req,res)=>{
        res.setHeader('Cache-Control','no-store');
        res.setHeader('Content-Type','application/json');
        if(req.method!=='GET'){res.statusCode=405;res.end('{}');return;}
        try{res.end(JSON.stringify({initial,current:identity()}));}
        catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
      });
    }
  }]});
await server.listen();
const address=server.httpServer.address();
if(!address||typeof address==='string')throw new Error('No local listening port');
console.log('Open on the reference device: http://127.0.0.1:'+address.port+'/scripts/living-world-acceptance.html');
console.log('Use normal Free Roam controls; N starts/finishes a profile, M marks rooftop idle/revisit. Ctrl+C stops the local server.');
