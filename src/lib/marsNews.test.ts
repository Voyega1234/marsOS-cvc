import assert from 'node:assert/strict'
import { extractFeedImage, extractMetaImage } from './marsNews'

assert.equal(
  extractFeedImage('<item><media:content url="https://a.com/x.jpg" type="image/jpeg"/></item>'),
  'https://a.com/x.jpg',
)
assert.equal(
  extractFeedImage('<item><media:thumbnail url="https://a.com/t.jpg"/></item>'),
  'https://a.com/t.jpg',
)
assert.equal(
  extractFeedImage('<item><enclosure url="https://a.com/e.png" type="image/png" length="1"/></item>'),
  'https://a.com/e.png',
)
assert.equal(
  extractFeedImage('<item><enclosure url="https://a.com/e.mp3" type="audio/mpeg"/></item>'),
  undefined,
)
// escaped <img> in description
assert.equal(
  extractFeedImage('<item><description><![CDATA[&lt;p&gt;&lt;img src=&quot;https://a.com/d.jpg&quot; /&gt;hi&lt;/p&gt;]]></description></item>'),
  'https://a.com/d.jpg',
)
// http -> https
assert.equal(
  extractFeedImage('<item><media:content url="http://a.com/h.jpg"/></item>'),
  'https://a.com/h.jpg',
)
// protocol-relative
assert.equal(
  extractFeedImage('<item><description>&lt;img src="//cdn.a.com/p.jpg"&gt;</description></item>'),
  'https://cdn.a.com/p.jpg',
)
// tracking pixels skipped
assert.equal(
  extractFeedImage('<item><description>&lt;img src="https://a.com/p.gif" width="1" height="1"&gt;</description></item>'),
  undefined,
)
assert.equal(
  extractFeedImage('<item><description>&lt;img src="https://feeds.feedburner.com/~r/x.gif"&gt;&lt;img src="https://a.com/real.jpg"&gt;</description></item>'),
  'https://a.com/real.jpg',
)
// data: rejected
assert.equal(
  extractFeedImage('<item><media:content url="data:image/png;base64,AAAA"/></item>'),
  undefined,
)
// atom summary
assert.equal(
  extractFeedImage('<entry><summary type="html">&lt;img src="https://a.com/s.jpg"&gt;</summary></entry>'),
  'https://a.com/s.jpg',
)
// none
assert.equal(extractFeedImage('<item><title>x</title><description>no image</description></item>'), undefined)

// og:image
assert.equal(
  extractMetaImage('<head><meta property="og:image" content="https://a.com/og.jpg"></head>'),
  'https://a.com/og.jpg',
)
assert.equal(
  extractMetaImage('<head><meta name="twitter:image" content="http://a.com/tw.jpg"></head>'),
  'https://a.com/tw.jpg',
)
assert.equal(extractMetaImage('<head></head>'), undefined)

console.log('marsNews tests passed')
