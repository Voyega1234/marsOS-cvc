// Public embed script. Paste on the client's website:
//   <script src="https://<hub>/embed.js?project=co-journey-visa"></script>
// (Older installs using data-project="co-journey-visa" instead of ?project= still work —
// see the fallback chain below.)
// It captures UTM + gclid/fbclid/ttclid + GA client id, records a click via the
// ingest API, then points every element with [data-line-add] to /line/start.
// It also reads the browser ids the ad platforms match on (GA4 session, _fbp, _fbc, _ttp, LINE Tag
// and Snapchat cookies),
// at page load and again when the visitor presses the LINE button.
//
// The snippet is a template literal: write no backtick and no dollar-brace inside it, and
// double every backslash.

const SNIPPET = `(function(){
  // Locate OUR script tag. document.currentScript is null when a tag manager injects
  // the snippet — GTM Custom HTML appends the <script> asynchronously — and the old
  // fallback ("the last <script> in the document") then landed on some unrelated
  // third-party script. data-project read null, so this bailed out with
  // "[LINEHub] missing data-project" and never tracked a single visit. Confirmed live
  // on a GTM-managed WordPress site, where the visitor count sat at 1 for weeks.
  // Worse: GTM's Custom HTML tag also drops arbitrary data-* attributes when it
  // recreates the <script> element to force execution — confirmed live on
  // convertcake.com, where "Use webhook"/URL/secret were all correct but
  // data-project still read null on every real page load. src is not affected (the
  // browser needs it to load the script at all), so ?project= on the src itself is
  // the one signal every tag manager preserves — resolve project from there FIRST,
  // then fall back to data-project / window globals for already-installed snippets.
  function pick(sel){ var n = document.querySelectorAll(sel); return n[n.length-1] || null; }
  var s = document.currentScript;
  if(!s || !s.getAttribute('data-project')){ s = pick('script[data-project]') || s; }

  var srcEl = (s && s.src) ? s : pick('script[src*="/embed.js"]');
  var srcProject = '';
  try { if (srcEl && srcEl.src) srcProject = new URL(srcEl.src).searchParams.get('project') || ''; } catch(e){}

  var project = srcProject || (s && s.getAttribute('data-project')) || window.LINEHubProject;
  if(!project){ console.warn('[LINEHub] missing project — add ?project=slug to the embed.js src'); return; }

  // Same story for the hub origin: fall back to whichever tag loaded embed.js, since
  // that is by definition the hub, then to an explicit global.
  var hub = (s && s.getAttribute('data-hub')) || window.LINEHubHost ||
            (srcEl && srcEl.src ? new URL(srcEl.src).origin : '');
  if(!hub){ console.warn('[LINEHub] cannot resolve hub origin'); return; }

  function qp(name){
    var m = new RegExp('[?&]'+name+'=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\\+/g,' ')) : '';
  }
  function gaClientId(){
    var m = document.cookie.match(/_ga=GA\\d\\.\\d\\.(\\d+\\.\\d+)/);
    return m ? m[1] : '';
  }
  // Browser ids the ad platforms match a later conversion on: the GA client id, the GA4
  // session cookie of every stream on the page (_ga_<STREAM>), Meta's _fbp / _fbc and
  // TikTok's _ttp. Read fresh on every call: at page load the analytics tags have often
  // not set their cookies yet, so the read that counts is the one taken when the visitor
  // presses the LINE button. The server checks every value before it keeps it.
  function browserIds(){
    var o = {}, gs = [], parts = (document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++){
      var p = parts[i], eq = p.indexOf('=');
      if (eq < 0) continue;
      var k = p.slice(0, eq).replace(/^ +/, ''), v = p.slice(eq + 1);
      if (k.indexOf('_ga_') === 0){ if (gs.length < 3) gs.push(k.slice(4) + ':' + v); }
      else if (k === '_fbp') o.fbp = v;
      else if (k === '_fbc') o.fbc = v;
      else if (k === '_ttp') o.ttp = v;
      else if (k === '__lt__cid') o.line_browser_id = v;
      else if (k === '_scid') o.scid = v;
    }
    var ga = gaClientId();
    if (ga) o.ga_client_id = ga;
    if (gs.length) o.ga_sessions = gs.join('~');
    return o;
  }

  var payload = {
    utm_source: qp('utm_source'), utm_medium: qp('utm_medium'),
    utm_campaign: qp('utm_campaign'), utm_adset: qp('utm_adset'),
    utm_content: qp('utm_content'), utm_term: qp('utm_term'),
    gclid: qp('gclid'), fbclid: qp('fbclid'), ttclid: qp('ttclid'),
    msclkid: qp('msclkid'), twclid: qp('twclid'), scclid: qp('scclid') || qp('sc_click_id') || qp('ScCid'),
    gbraid: qp('gbraid'), wbraid: qp('wbraid'), line_click_id: qp('ldtag_cl'),
    ga_client_id: gaClientId(),
    landing_url: location.href, referrer: document.referrer
  };
  var firstIds = browserIds();
  for (var idKey in firstIds){ payload[idKey] = firstIds[idKey]; }

  var LS = 'linehub_click_' + project;
  // Recognise every common "go to our LINE OA" URL shape. Besides LINE's own hosts
  // (lin.ee / line.me / liff.line / line://), Thai sites frequently route the button
  // through a QR/redirect service — lineutm.com being the one in the wild here — so a
  // click on it is still an Add-LINE intent and must count. Miss it and the "กดปุ่ม
  // Add LINE" funnel stage stays 0 and lead attribution loses its 3h click window.
  function isLineLink(h){ return /lin\\.ee|line\\.me|liff\\.line|line:\\/\\/|lineutm\\.com/i.test(h || ''); }
  function wire(clickId){
    // Remember the click; DO NOT change the LINE button — keep native 1-tap add.
    try { localStorage.setItem(LS, clickId); } catch(e){}
    window.LINEHubClickId = clickId;

    // Record when a visitor actually CLICKS an Add-LINE button (intent), from ANY
    // channel — ads, organic, direct. Fire-and-forget; the button still works.
    function trackLineClick(){
      try {
        // Pass via query string so sendBeacon works cross-origin (a JSON body
        // would need a CORS preflight that beacons can't do → silently dropped).
        var u = hub + '/api/track/' + encodeURIComponent(project) +
          '?event=lineclick&click_id=' + encodeURIComponent(clickId);
        // The browser ids as they are right now. This is also the only read a returning
        // visitor gets: their stored click is reused and no new page-load record is sent.
        var ids = browserIds();
        for (var idKey in ids){ u += '&' + idKey + '=' + encodeURIComponent(ids[idKey]); }
        if (navigator.sendBeacon) navigator.sendBeacon(u);
        else fetch(u, { method: 'POST', keepalive: true, mode: 'no-cors' });
      } catch (e) {}
    }
    // Event delegation on the document → catches clicks on ANY LINE button even
    // if it was added to the page after this script ran (GTM, dynamic content).
    document.addEventListener('click', function(e){
      var node = e.target;
      for (var k = 0; k < 6 && node && node.nodeType === 1; k++){
        if (node.getAttribute && !(node.hasAttribute && node.hasAttribute('data-line-skip'))){
          if ((node.hasAttribute && node.hasAttribute('data-line-add')) || isLineLink(node.getAttribute('href'))){
            trackLineClick();
            return;
          }
        }
        node = node.parentNode;
      }
    }, true);

    // Mode 1 (transparent): route [data-line-add] straight to LINE add-friend via
    // /line/start (no LINE Login screen — customer notices nothing).
    var els = document.querySelectorAll('[data-line-add]');
    if (els.length){
      var url = hub + '/line/start?project=' + encodeURIComponent(project) + '&click_id=' + encodeURIComponent(clickId);
      for (var i=0;i<els.length;i++){
        var el = els[i];
        if (el.tagName === 'A'){ el.setAttribute('href', url); }
      }
    }
  }

  var existing = null; try { existing = localStorage.getItem(LS); } catch(e){}
  var hasAd = payload.gclid || payload.fbclid || payload.ttclid || payload.msclkid || payload.twclid || payload.scclid ||
    payload.gbraid || payload.wbraid || payload.line_click_id || payload.utm_source;
  if (existing && !hasAd){ wire(existing); return; }

  fetch(hub + '/api/track/' + encodeURIComponent(project), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.json(); })
  .then(function(d){ if (d && d.clickId) wire(d.clickId); })
  .catch(function(e){ console.warn('[LINEHub] track failed', e); });
})();
`;

export function GET() {
  return new Response(SNIPPET, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Browser: 60 s, as before. Shared cache (CDN): 1 hour, and it may keep serving the
      // old copy while it fetches a new one. The script is the same for every project, so
      // one cached copy serves every website that embeds it.
      "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
}
