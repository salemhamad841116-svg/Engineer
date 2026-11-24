/**
 * UI Builder Mode — Layer 4/5: Sandboxed Preview Runtime Bridge.
 *
 * A small English-only script injected before </body> when serving a build.
 * It implements the postMessage protocol between the host panel (React)
 * and the isolated iframe — zero reloads, zero LLM:
 *
 *   parent → iframe:
 *     {ns:'uib', type:'inspect', on:boolean}   toggle hover-highlight mode
 *     {ns:'uib', type:'set-prop', id, prop, value}
 *     {ns:'uib', type:'set-text', id, text}
 *     {ns:'uib', type:'set-image', slot, src}
 *     {ns:'uib', type:'theme', theme:'dark'|'light'|'glass'}
 *     {ns:'uib', type:'dir', dir:'rtl'|'ltr'}
 *   iframe → parent:
 *     {ns:'uib', type:'ready'}
 *     {ns:'uib', type:'select', id}            user clicked a component
 *     {ns:'uib', type:'asset-select', slot}    user clicked an image
 *
 * The bridge never evals remote code; messages are shape-checked.
 */
export const PREVIEW_BRIDGE_SCRIPT = `<script>
(function(){
  'use strict';
  var NS='uib', inspecting=false, last=null, hl=null;
  function box(){ if(!hl){ hl=document.createElement('div'); hl.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,.12);transition:all .08s'; document.body.appendChild(hl);} return hl; }
  function hide(){ if(hl){ hl.remove(); hl=null; } last=null; }
  function post(o){ try{ o.ns=NS; parent.postMessage(o,'*'); }catch(e){} }
  function findId(el){ while(el&&el!==document.body){ if(el.getAttribute&&el.getAttribute('data-ui-id')) return el; el=el.parentElement; } return null; }
  function findAsset(el){ while(el&&el!==document.body){ if(el.getAttribute&&el.getAttribute('data-ui-asset')) return el; el=el.parentElement; } return null; }
  document.addEventListener('mousemove',function(e){
    if(!inspecting) return;
    var t=findId(e.target); if(!t||t===last) return; last=t;
    var r=t.getBoundingClientRect(), b=box();
    b.style.left=r.left+'px'; b.style.top=r.top+'px'; b.style.width=r.width+'px'; b.style.height=r.height+'px';
  },true);
  document.addEventListener('click',function(e){
    if(!inspecting) return;
    e.preventDefault(); e.stopPropagation();
    var a=findAsset(e.target); if(a){ post({type:'asset-select',slot:a.getAttribute('data-ui-asset')}); return; }
    var t=findId(e.target); if(t) post({type:'select',id:t.getAttribute('data-ui-id')});
  },true);
  window.addEventListener('message',function(ev){
    var m=ev&&ev.data; if(!m||m.ns!==NS||typeof m.type!=='string') return;
    if(m.type==='inspect'){ inspecting=!!m.on; if(!inspecting) hide(); return; }
    if(m.type==='theme'){ document.documentElement.setAttribute('data-theme',String(m.theme)); return; }
    if(m.type==='dir'){ document.documentElement.setAttribute('dir',m.dir==='ltr'?'ltr':'rtl'); return; }
    if(m.type==='set-prop'&&m.id&&typeof m.prop==='string'){
      var n=document.querySelector('[data-ui-id="'+m.id+'"]'); if(n) n.style.setProperty(m.prop,String(m.value)); return; }
    if(m.type==='set-text'&&m.id){
      var t2=document.querySelector('[data-ui-id="'+m.id+'"]'); if(t2) t2.textContent=String(m.value); return; }
    if(m.type==='set-image'&&m.slot){
      var im=document.querySelector('[data-ui-asset="'+m.slot+'"]'); if(im) im.src=String(m.src); return; }
  });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ post({type:'ready'}); });
  else post({type:'ready'});
})();
</` + `script>`;

/** Inject the bridge before </body> (or append) — idempotent. */
export function injectBridge(html) {
  if (html.includes("var NS='uib'")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${PREVIEW_BRIDGE_SCRIPT}\n</body>`);
  return `${html}\n${PREVIEW_BRIDGE_SCRIPT}`;
}
