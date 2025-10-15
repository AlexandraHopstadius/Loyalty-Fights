import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.concurrent.*;

public class SimpleFileServer {
    public static void main(String[] args) throws Exception {
    int port = 8000;
    Path root = Paths.get(".").toAbsolutePath().normalize();
    if (args.length > 0) port = Integer.parseInt(args[0]);
    if (args.length > 1) root = Paths.get(args[1]).toAbsolutePath().normalize();

    final Path docRoot = root; // must be effectively final for lambda capture

    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.createContext("/", exchange -> handle(exchange, docRoot));
        server.setExecutor(Executors.newFixedThreadPool(4));
        System.out.println("Serving " + root + " on http://0.0.0.0:" + port);
        server.start();
    }

    private static void handle(HttpExchange exchange, Path root) throws IOException {
        URI uri = exchange.getRequestURI();
        String pathStr = uri.getPath();
        if (pathStr.startsWith("/")) pathStr = pathStr.substring(1);
        Path path = root.resolve(pathStr).normalize();

        // Prevent path traversal
        if (!path.startsWith(root)) {
            exchange.sendResponseHeaders(403, -1);
            return;
        }

        if (Files.isDirectory(path)) {
            path = path.resolve("index.html");
        }

        if (!Files.exists(path) || Files.isDirectory(path)) {
            byte[] notFound = "404 (Not Found)\n".getBytes();
            exchange.sendResponseHeaders(404, notFound.length);
            try (OutputStream os = exchange.getResponseBody()) { os.write(notFound); }
            return;
        }

        String contentType = Files.probeContentType(path);
        if (contentType == null) contentType = "application/octet-stream";
        exchange.getResponseHeaders().set("Content-Type", contentType);
        long len = Files.size(path);
        exchange.sendResponseHeaders(200, len);
        try (OutputStream os = exchange.getResponseBody(); InputStream is = Files.newInputStream(path)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = is.read(buf)) != -1) os.write(buf, 0, r);
        }
    }
}
