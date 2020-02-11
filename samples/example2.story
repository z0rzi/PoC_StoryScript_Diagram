
redis set key:"count" value:0
when http server listen path:"/counter" as request
  count = redis increment key:"count" by:1
  request write content:"This page has been visited {count} times"
