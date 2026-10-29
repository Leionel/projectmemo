// Isolated TLS SMTP sink for browser acceptance. Only dummy accounts are used.
// Its certificate/key and messages stay in ignored tmp/, never in evidence.
import tls from "node:tls";
import fs from "node:fs";
fs.mkdirSync("tmp/home-auth-smtp/messages", { recursive: true });
let sequence = 0;
tls.createServer({ key: fs.readFileSync("tmp/home-auth-smtp/key.pem"), cert: fs.readFileSync("tmp/home-auth-smtp/cert.pem") }, socket => {
  socket.setEncoding("utf8");
  socket.write("220 localhost test SMTP\r\n");
  let pending = "", data = false, message = "";
  socket.on("data", chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\r\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2);
      if (data) {
        if (line === ".") {
          fs.writeFileSync("tmp/home-auth-smtp/messages/" + String(++sequence).padStart(3, "0") + ".eml", message);
          data = false; message = ""; socket.write("250 queued\r\n");
        } else message += line.replace(/^\.\./, ".") + "\r\n";
      } else if (/^EHLO|^HELO/i.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
      else if (/^AUTH PLAIN/i.test(line)) socket.write("235 authenticated\r\n");
      else if (/^DATA$/i.test(line)) { data = true; socket.write("354 send message\r\n"); }
      else if (/^QUIT$/i.test(line)) socket.end("221 bye\r\n");
      else socket.write("250 OK\r\n");
    }
  });
  socket.on("error", () => undefined);
}).listen(3465, "127.0.0.1", () => console.log("Isolated TLS mail sink ready on 3465; messages stay in tmp/."));
