import http.server, os
os.chdir('/Users/yunamoon/Desktop/_Calix/Calix_files')
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8080, bind='127.0.0.1')
