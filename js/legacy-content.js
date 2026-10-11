/* Explicit, validated legacy conversion. Never renders the source HTML. */
(function(root){
 'use strict';
 var schema=typeof module==='object'&&module.exports?require('./community-schema.js'):root.CommunitySchema;
 function Legacy_Convert(html,options){
  var parsed=new options.DOMParser().parseFromString(String(html),'text/html'),blocks=[],refs=[],media=options.assets||{},base=options.base||'https://hsh-personal-blog.pages.dev/';
  if(parsed.querySelector('script,iframe,object,embed,style,svg,math,form,input')||Array.from(parsed.querySelectorAll('*')).some(function(n){return Array.from(n.attributes).some(function(a){return /^on/i.test(a.name);});}))throw Error('Unsafe legacy markup');
  Array.from(parsed.querySelectorAll('a[href]')).forEach(function(a){var href=a.getAttribute('href');if(!/^\/?assets\//.test(href)&&!schema.safeLink(new URL(href,base).href))throw Error('Unsafe legacy link');});
  function Legacy_Path(value){var u=new URL(value,base);if(u.origin!==new URL(base).origin||u.search||u.hash)throw Error('Legacy media must be a reviewed local file');return decodeURIComponent(u.pathname.replace(/^\//,''));}
  function Legacy_Asset(value){var path=Legacy_Path(value),id=media[path];if(!schema.uuid(id))throw Error('Legacy media has no verified private asset: '+path);if(!refs.includes(id))refs.push(id);return {type:'asset',asset_id:id};}
  function Legacy_Runs(node,marks,href){var runs=[];
   Array.from(node.childNodes).forEach(function(n){if(n.nodeType===3){if(n.nodeValue){var run={text:n.nodeValue};if(marks.length)run.marks=marks;if(href)run.href=href;runs.push(run);}return;}if(n.nodeType!==1)return;
    if(Array.from(n.attributes).some(function(a){return /^on/i.test(a.name);})||['SCRIPT','IFRAME','OBJECT','EMBED','STYLE','SVG','MATH','FORM','INPUT'].includes(n.tagName))throw Error('Unsafe legacy markup');
    if(n.tagName==='IMG'||n.tagName==='VIDEO'||(n.tagName==='A'&&/^\/?assets\//.test(n.getAttribute('href')||'')))throw Error('Nested media requires block conversion');
    if(n.tagName==='BR'){runs.push({text:'\n'});return;}
    var next=marks.slice();if(['STRONG','B'].includes(n.tagName)&&!next.includes('bold'))next.push('bold');if(['EM','I'].includes(n.tagName)&&!next.includes('italic'))next.push('italic');
    var link=href;if(n.tagName==='A'){link=new URL(n.getAttribute('href'),base).href;if(!schema.safeLink(link))throw Error('Unsafe legacy link');}
    runs=runs.concat(Legacy_Runs(n,next,link));
   });return runs;
  }
  function Legacy_Block(n){
   if(n.nodeType===3){if(n.nodeValue.trim())blocks.push({type:'paragraph',runs:[{text:n.nodeValue}]});return;}
   if(n.nodeType!==1)return;
   if(Array.from(n.attributes).some(function(a){return /^on/i.test(a.name);})||['SCRIPT','IFRAME','OBJECT','EMBED','STYLE','SVG','MATH','FORM','INPUT'].includes(n.tagName))throw Error('Unsafe legacy markup');
   if(n.tagName==='IMG'||n.tagName==='VIDEO'){blocks.push(Legacy_Asset(n.getAttribute('src')||(n.querySelector('source')||{}).src));return;}
   if(n.tagName==='A'&&/^\/?assets\//.test(n.getAttribute('href')||'')){blocks.push(Legacy_Asset(n.getAttribute('href')));return;}
   if(['A','STRONG','B','EM','I','SPAN'].includes(n.tagName)){var inline=parsed.createElement('span');inline.appendChild(n.cloneNode(true));blocks.push({type:'paragraph',runs:Legacy_Runs(inline,[],null)});return;}
   if(['DIV','SECTION','ARTICLE','FIGURE'].includes(n.tagName)){Array.from(n.childNodes).forEach(Legacy_Block);return;}
   if(n.querySelector('img,video,a[href^="assets/"]')){var part=[];Array.from(n.childNodes).forEach(function(c){if(c.nodeType===1&&(c.tagName==='IMG'||c.tagName==='VIDEO'||c.tagName==='A'&&/^assets\//.test(c.getAttribute('href')||''))){if(part.length){var span=parsed.createElement('span');part.forEach(function(v){span.appendChild(v.cloneNode(true));});blocks.push({type:'paragraph',runs:Legacy_Runs(span,[],null)});part=[];}Legacy_Block(c);}else part.push(c);});if(part.length){var span=parsed.createElement('span');part.forEach(function(v){span.appendChild(v.cloneNode(true));});blocks.push({type:'paragraph',runs:Legacy_Runs(span,[],null)});}return;}
   if(['UL','OL'].includes(n.tagName)){blocks.push({type:'list',ordered:n.tagName==='OL',items:Array.from(n.children).map(function(li){if(li.tagName!=='LI')throw Error('Invalid legacy list');return Legacy_Runs(li,[],null);})});return;}
   var b={type:/^H[1-6]$/.test(n.tagName)?'heading':n.tagName==='BLOCKQUOTE'?'quote':n.tagName==='PRE'?'code':'paragraph',runs:Legacy_Runs(n,[],null)};if(b.type==='heading')b.level=n.tagName==='H1'||n.tagName==='H2'?2:3;blocks.push(b);
  }
  Array.from(parsed.body.childNodes).forEach(Legacy_Block);var document={version:1,blocks:blocks};schema.validateDocument(document,refs,100000);return {document:document,text:schema.documentText(document),asset_ids:refs};
 }
 var api={convert:Legacy_Convert};if(typeof module==='object'&&module.exports)module.exports=api;else root.LegacyContent=api;
})(typeof window==='object'?window:globalThis);
