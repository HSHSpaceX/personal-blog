/* Legacy entry URL, shared account workspace. No GitHub credentials or writes. */
(function(){
 'use strict';
 window.BlogTheme.setup();
 window.BlogAuth.ready().then(function(){
  window.BlogAuth.requireUser();
  var routes={pages:'site-settings',messages:'comment-moderation',resources:'assets',legacy:'articles'};
  var route=routes[location.hash.slice(1)]||'articles';
  location.replace('account.html'+location.search+'#'+route);
 }).catch(function(error){document.getElementById('adminRedirectStatus').textContent=error.message;});
})();
