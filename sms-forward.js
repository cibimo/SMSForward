// 读取 Loon 插件参数（安装/编辑插件时填写的值），未填写时返回 fallback
function readArg(name, fallback) {
  try {
    const v = $persistentStore.read(name)
    if (v != null && `${v}`.trim() !== '') return `${v}`.trim()
  } catch (e) {}
  return fallback
}

// ==================== 配置区 ====================
// 全部配置都在 Loon 插件参数里填写（配置 → 插件 → 短信转发 → 参数），
// 下面括号里的值只是插件参数未填写时的默认值
const userConfig = {
  // 是否停用转发：true 时收到短信不做任何转发（默认 false）
  disabled: readArg('disabled', 'false') === 'true',

  // 转发地址（必填）：收到短信后 POST JSON 到这个 URL
  webhookUrl: readArg('webhookUrl', ''),

  // 设备 ID（默认 iphonex）
  deviceId: readArg('deviceId', 'iphonex'),

  // 收件手机号（本机号码，可留空）
  recipient: readArg('recipient', ''),

  // SIM 卡号：1 或 2（默认 1）
  simNumber: Number(readArg('simNumber', 1)) || 1,

  // 固定使用的 webhookId；留空则每次随机生成
  webhookId: readArg('webhookId', ''),

  // 只转发号码匹配该正则的短信，留空表示不限制
  senderAllow: readArg('senderAllow', ''),
  // 号码匹配该正则的短信不转发，留空表示不限制
  senderDeny: readArg('senderDeny', ''),
  // 只转发内容匹配该正则的短信，留空表示不限制
  textAllow: readArg('textAllow', ''),
  // 内容匹配该正则的短信不转发，留空表示不限制
  textDeny: readArg('textDeny', ''),

  // 提交给腾讯/360 等接口的内容是否将数字替换为随机数字（默认 true）
  replaceNum: readArg('replaceNum', 'true') !== 'false',
  // 是否不提交数据给腾讯/360 等接口：true 时清空请求体后放行（默认 false）
  noPost: readArg('noPost', 'false') === 'true',
}
// ================================================

const key = 'sms_forward'

const config = {
  tencent: {
    sender: 'query.sender',
    text: 'query.message.text',
  },
  360: {
    sender: 'query.sender',
    text: 'query.message.text',
  },
}
const $ = new Env(key)

let result

!(async () => {
  if (userConfig.disabled) {
    $.log('ℹ️ 已禁用')
    return
  }

  const requestUrl = String($.lodash_get($request, 'url') || '')
  const type = requestUrl.includes('360.cn') ? '360' : 'tencent'

  let input = $request.body
  $.log('ℹ️ 请求')
  $.log(input)
  try {
    input = JSON.parse(input)
  } catch (e) {
    console.log(e)
    throw new Error('解析请求失败')
  }
  $.log('ℹ️ 解析后的请求')
  $.log(input)

  let text = $.lodash_get(input, config[type].text)
  let sender = $.lodash_get(input, config[type].sender)
  sender = sender == null ? '' : `${sender}`
  text = text == null ? '' : `${text}`
  console.log(`号码 ${sender}`)
  console.log(`内容 ${text}`)

  if (isAllowed(sender, text)) {
    await forwardWebhook(sender, text)
  } else {
    console.log('已判断号码和内容 ❌ 不会转发')
  }

  if (userConfig.noPost) {
    $.log('ℹ️ 不提交数据给腾讯/360等接口，将清空请求体')
    return
  }
  $.log('ℹ️ 将提交数据给腾讯/360等接口')
  result = input

  if (userConfig.replaceNum) {
    $.log('ℹ️ 替换数字')
    $.log(`ℹ️ 原内容 ${text}`)
    text = text.replace(/\d/g, i => Math.floor(Math.random() * (9 - 1 + 1)) + 1)
    $.log(`🆕 新内容 ${text}`)
    lodash_set(result, config[type].text, text)
  }
})()
  .catch(e => {
    console.log(e)
    $.msg('短信转发', '❌', `${$.lodash_get(e, 'message') || $.lodash_get(e, 'error') || e}`)
  })
  .finally(() => {
    // Loon 的 $done 改写请求必须用 { url, headers, body } 形式，直接传普通对象不会生效
    if (userConfig.noPost) {
      console.log('清空请求体后放行（不提交数据给腾讯/360等接口）')
      $.done({ body: '' })
      return
    }
    if (result == null) {
      $.done({})
      return
    }
    const body = $.toStr(result)
    console.log('提交给腾讯/360等接口的数据')
    console.log(body)
    $.done({ body })
  })

function isAllowed(sender, text) {
  const { senderAllow, senderDeny, textAllow, textDeny } = userConfig
  if (senderAllow) {
    console.log(`允许转发的号码的正则字符串 ${senderAllow}`)
    if (!new RegExp(senderAllow).test(sender)) {
      console.log(`${sender} 不符合允许转发的号码 ❌不会转发`)
      return false
    }
  } else if (senderDeny) {
    console.log(`不允许转发的号码的正则字符串 ${senderDeny}`)
    if (new RegExp(senderDeny).test(sender)) {
      console.log(`${sender} 符合不允许转发的号码 ❌不会转发`)
      return false
    }
  }
  if (textAllow) {
    console.log(`允许转发的内容的正则字符串 ${textAllow}`)
    if (!new RegExp(textAllow).test(text)) {
      console.log(`${text} 不符合允许转发的内容 ❌不会转发`)
      return false
    }
  } else if (textDeny) {
    console.log(`不允许转发的内容的正则字符串 ${textDeny}`)
    if (new RegExp(textDeny).test(text)) {
      console.log(`${text} 符合不允许转发的内容 ❌不会转发`)
      return false
    }
  }
  return true
}

async function forwardWebhook(sender, text) {
  const url = userConfig.webhookUrl
  if (!url) {
    $.log('⚠️ 未配置 webhookUrl，跳过 Webhook 转发')
    $.msg('[短信转发 未配置 Webhook 本地预览]', sender, text)
    return
  }

  const body = {
    deviceId: userConfig.deviceId,
    event: 'sms:received',
    id: `I_${randomStr(19)}`,
    payload: {
      message: text,
      receivedAt: isoTime(new Date()),
      messageId: randomHex(8),
      phoneNumber: sender,
      recipient: userConfig.recipient,
      sender: sender,
      simNumber: userConfig.simNumber,
    },
    webhookId: userConfig.webhookId || randomStr(21),
  }

  const req = {
    url,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  }

  $.log('ℹ️ Webhook 请求')
  $.log($.toStr(body))
  const res = await $.http.post(req)
  const status = Number($.lodash_get(res, 'status'))
  const resBody = String($.lodash_get(res, 'body') || $.lodash_get(res, 'rawBody') || '')
  $.log('↓ res status')
  $.log(status)
  $.log('↓ res body')
  $.log(resBody)
  if (!(status >= 200 && status < 300)) {
    throw new Error(`Webhook 请求失败，状态码 ${status}`)
  }
}

// 生成指定长度的随机字符串
function randomStr(length) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'
  let str = ''
  for (let i = 0; i < length; i++) {
    str += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return str
}

// 生成指定长度的随机十六进制字符串
function randomHex(length) {
  const alphabet = '0123456789abcdef'
  let str = ''
  for (let i = 0; i < length; i++) {
    str += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return str
}

// 本地时区的 ISO 8601 时间，例如 2026-10-25T09:08:31.000+08:00
function isoTime(date) {
  const pad = (n, l = 2) => String(Math.abs(n)).padStart(l, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

function lodash_set(obj, path, value) {
  if (Object(obj) !== obj) return obj // When obj is not an object
  // If not yet an array, get the keys from the string-path
  if (!Array.isArray(path)) path = path.toString().match(/[^.[\]]+/g) || []
  path.slice(0, -1).reduce(
    (
      a,
      c,
      i // Iterate all of them except the last one
    ) =>
      Object(a[c]) === a[c] // Does the key exist and is its value an object?
        ? // Yes: then follow that path
          a[c]
        : // No: create the key. Is the next key a potential array-index?
          (a[c] =
            Math.abs(path[i + 1]) >> 0 === +path[i + 1]
              ? [] // Yes: assign a new array object
              : {}), // No: assign a new plain object
    obj
  )[path[path.length - 1]] = value // Finally assign the value to the last key
  return obj // Return the top-level object to allow chaining
}

// prettier-ignore
function Env(t,e){class s{constructor(t){this.env=t}send(t,e="GET"){t="string"==typeof t?{url:t}:t;let s=this.get;return"POST"===e&&(s=this.post),new Promise((e,i)=>{s.call(this,t,(t,s,r)=>{t?i(t):e(s)})})}get(t){return this.send.call(this.env,t)}post(t){return this.send.call(this.env,t,"POST")}}return new class{constructor(t,e){this.name=t,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.encoding="utf-8",this.startTime=(new Date).getTime(),Object.assign(this,e),this.log("",`\ud83d\udd14${this.name}, \u5f00\u59cb!`)}isNode(){return"undefined"!=typeof module&&!!module.exports}isQuanX(){return"undefined"!=typeof $task}isSurge(){return"undefined"!=typeof $httpClient&&"undefined"==typeof $loon}isLoon(){return"undefined"!=typeof $loon}isShadowrocket(){return"undefined"!=typeof $rocket}isStash(){return"undefined"!=typeof $environment&&$environment["stash-version"]}toObj(t,e=null){try{return JSON.parse(t)}catch{return e}}toStr(t,e=null){try{return JSON.stringify(t)}catch{return e}}getjson(t,e){let s=e;const i=this.getdata(t);if(i)try{s=JSON.parse(this.getdata(t))}catch{}return s}setjson(t,e){try{return this.setdata(JSON.stringify(t),e)}catch{return!1}}getScript(t){return new Promise(e=>{this.get({url:t},(t,s,i)=>e(i))})}runScript(t,e){return new Promise(s=>{let i=this.getdata("@chavy_boxjs_userCfgs.httpapi");i=i?i.replace(/\n/g,"").trim():i;let r=this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");r=r?1*r:20,r=e&&e.timeout?e.timeout:r;const[o,a]=i.split("@"),n={url:`http://${a}/v1/scripting/evaluate`,body:{script_text:t,mock_type:"cron",timeout:r},headers:{"X-Key":o,Accept:"*/*"}};this.post(n,(t,e,i)=>s(i))}).catch(t=>this.logErr(t))}loaddata(){if(!this.isNode())return{};{this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e);if(!s&&!i)return{};{const i=s?t:e;try{return JSON.parse(this.fs.readFileSync(i))}catch(t){return{}}}}}writedata(){if(this.isNode()){this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e),r=JSON.stringify(this.data);s?this.fs.writeFileSync(t,r):i?this.fs.writeFileSync(e,r):this.fs.writeFileSync(t,r)}}lodash_get(t,e,s){const i=e.replace(/\[(\d+)\]/g,".$1").split(".");let r=t;for(const t of i)if(r=Object(r)[t],void 0===r)return s;return r}lodash_set(t,e,s){return Object(t)!==t?t:(Array.isArray(e)||(e=e.toString().match(/[^.[\]]+/g)||[]),e.slice(0,-1).reduce((t,s,i)=>Object(t[s])===t[s]?t[s]:t[s]=Math.abs(e[i+1])>>0==+e[i+1]?[]:{},t)[e[e.length-1]]=s,t)}getdata(t){let e=this.getval(t);if(/^@/.test(t)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(t),r=s?this.getval(s):"";if(r)try{const t=JSON.parse(r);e=t?this.lodash_get(t,i,""):e}catch(t){e=""}}return e}setdata(t,e){let s=!1;if(/^@/.test(e)){const[,i,r]=/^@(.*?)\.(.*?)$/.exec(e),o=this.getval(i),a=i?"null"===o?null:o||"{}":"{}";try{const e=JSON.parse(a);this.lodash_set(e,r,t),s=this.setval(JSON.stringify(e),i)}catch(e){const o={};this.lodash_set(o,r,t),s=this.setval(JSON.stringify(o),i)}}else s=this.setval(t,e);return s}getval(t){return this.isSurge()||this.isLoon()?$persistentStore.read(t):this.isQuanX()?$prefs.valueForKey(t):this.isNode()?(this.data=this.loaddata(),this.data[t]):this.data&&this.data[t]||null}setval(t,e){return this.isSurge()||this.isLoon()?$persistentStore.write(t,e):this.isQuanX()?$prefs.setValueForKey(t,e):this.isNode()?(this.data=this.loaddata(),this.data[e]=t,this.writedata(),!0):this.data&&this.data[e]||null}initGotEnv(t){this.got=this.got?this.got:require("got"),this.cktough=this.cktough?this.cktough:require("tough-cookie"),this.ckjar=this.ckjar?this.ckjar:new this.cktough.CookieJar,t&&(t.headers=t.headers?t.headers:{},void 0===t.headers.Cookie&&void 0===t.cookieJar&&(t.cookieJar=this.ckjar))}get(t,e=(()=>{})){if(t.headers&&(delete t.headers["Content-Type"],delete t.headers["Content-Length"]),this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.get(t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),e(t,s,i)});else if(this.isQuanX())this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t&&t.error||"UndefinedError"));else if(this.isNode()){let s=require("iconv-lite");this.initGotEnv(t),this.got(t).on("redirect",(t,e)=>{try{if(t.headers["set-cookie"]){const s=t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();s&&this.ckjar.setCookieSync(s,null),e.cookieJar=this.ckjar}}catch(t){this.logErr(t)}}).then(t=>{const{statusCode:i,statusCode:r,headers:o,rawBody:a}=t,n=s.decode(a,this.encoding);e(null,{status:i,statusCode:r,headers:o,rawBody:a,body:n},n)},t=>{const{message:i,response:r}=t;e(i,r,r&&s.decode(r.rawBody,this.encoding))})}}post(t,e=(()=>{})){const s=t.method?t.method.toLocaleLowerCase():"post";if(t.body&&t.headers&&!t.headers["Content-Type"]&&(t.headers["Content-Type"]="application/x-www-form-urlencoded"),t.headers&&delete t.headers["Content-Length"],this.isSurge()||this.isLoon())this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient[s](t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status?s.status:s.statusCode,s.status=s.statusCode),e(t,s,i)});else if(this.isQuanX())t.method=s,this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).then(t=>{const{statusCode:s,statusCode:i,headers:r,body:o}=t;e(null,{status:s,statusCode:i,headers:r,body:o},o)},t=>e(t&&t.error||"UndefinedError"));else if(this.isNode()){let i=require("iconv-lite");this.initGotEnv(t);const{url:r,...o}=t;this.got[s](r,o).then(t=>{const{statusCode:s,statusCode:r,headers:o,rawBody:a}=t,n=i.decode(a,this.encoding);e(null,{status:s,statusCode:r,headers:o,rawBody:a,body:n},n)},t=>{const{message:s,response:r}=t;e(s,r,r&&i.decode(r.rawBody,this.encoding))})}}time(t,e=null){const s=e?new Date(e):new Date;let i={"M+":s.getMonth()+1,"d+":s.getDate(),"H+":s.getHours(),"m+":s.getMinutes(),"s+":s.getSeconds(),"q+":Math.floor((s.getMonth()+3)/3),S:s.getMilliseconds()};/(y+)/.test(t)&&(t=t.replace(RegExp.$1,(s.getFullYear()+"").substr(4-RegExp.$1.length)));for(let e in i)new RegExp("("+e+")").test(t)&&(t=t.replace(RegExp.$1,1==RegExp.$1.length?i[e]:("00"+i[e]).substr((""+i[e]).length)));return t}msg(e=t,s="",i="",r){const o=t=>{if(!t)return t;if("string"==typeof t)return this.isLoon()?t:this.isQuanX()?{"open-url":t}:this.isSurge()?{url:t}:void 0;if("object"==typeof t){if(this.isLoon()){let e=t.openUrl||t.url||t["open-url"],s=t.mediaUrl||t["media-url"];return{openUrl:e,mediaUrl:s}}if(this.isQuanX()){let e=t["open-url"]||t.url||t.openUrl,s=t["media-url"]||t.mediaUrl,i=t["update-pasteboard"]||t.updatePasteboard;return{"open-url":e,"media-url":s,"update-pasteboard":i}}if(this.isSurge()){let e=t.url||t.openUrl||t["open-url"];return{url:e}}}};if(this.isMute||(this.isSurge()||this.isLoon()?$notification.post(e,s,i,o(r)):this.isQuanX()&&$notify(e,s,i,o(r))),!this.isMuteLog){let t=["","==============\ud83d\udce3\u7cfb\u7edf\u901a\u77e5\ud83d\udce3=============="];t.push(e),s&&t.push(s),i&&t.push(i),console.log(t.join("\n")),this.logs=this.logs.concat(t)}}log(...t){t.length>0&&(this.logs=[...this.logs,...t]),console.log(t.join(this.logSeparator))}logErr(t,e){const s=!this.isSurge()&&!this.isQuanX()&&!this.isLoon();s?this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t.stack):this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t)}wait(t){return new Promise(e=>setTimeout(e,t))}done(t={}){const e=(new Date).getTime(),s=(e-this.startTime)/1e3;this.log("",`\ud83d\udd14${this.name}, \u7ed3\u675f! \ud83d\udd5b ${s} \u79d2`),this.log(),this.isSurge()||this.isQuanX()||this.isLoon()?$done(t):this.isNode()&&process.exit(1)}}(t,e)}
