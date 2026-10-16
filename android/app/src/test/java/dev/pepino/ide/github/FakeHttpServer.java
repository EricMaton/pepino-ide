package dev.pepino.ide.github;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * A tiny HTTP/1.1 server for tests: one request per connection, answered by
 * [handler]. (The JDK's own server is not on Android's test classpath.)
 */
final class FakeHttpServer implements AutoCloseable {

    record Request(String method, String path, Map<String, String> headers, String body) {}

    record Response(int status, String body) {}

    interface Handler {
        Response handle(Request request);
    }

    private final ServerSocket socket;
    private final Thread thread;

    FakeHttpServer(Handler handler) throws IOException {
        socket = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        thread = new Thread(() -> {
            while (!socket.isClosed()) {
                try (Socket client = socket.accept()) {
                    Response response = handler.handle(read(client.getInputStream()));
                    byte[] body = response.body().getBytes(StandardCharsets.UTF_8);
                    OutputStream out = client.getOutputStream();
                    out.write((
                        "HTTP/1.1 " + response.status() + " X\r\n"
                            + "Content-Type: application/json\r\n"
                            + "Content-Length: " + body.length + "\r\n"
                            + "Connection: close\r\n\r\n"
                    ).getBytes(StandardCharsets.UTF_8));
                    out.write(body);
                    out.flush();
                } catch (IOException ignored) {
                    // closed, or a client that went away
                }
            }
        });
        thread.setDaemon(true);
        thread.start();
    }

    String url() {
        return "http://127.0.0.1:" + socket.getLocalPort();
    }

    private static Request read(InputStream in) throws IOException {
        String requestLine = line(in);
        Map<String, String> headers = new HashMap<>();
        for (String header; !(header = line(in)).isEmpty(); ) {
            int colon = header.indexOf(':');
            headers.put(header.substring(0, colon).trim().toLowerCase(Locale.ROOT), header.substring(colon + 1).trim());
        }
        int length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        byte[] body = new byte[length];
        for (int read = 0; read < length; ) read += in.read(body, read, length - read);
        String[] parts = requestLine.split(" ");
        return new Request(parts[0], parts[1], headers, new String(body, StandardCharsets.UTF_8));
    }

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int c; (c = in.read()) != -1 && c != '\n'; ) if (c != '\r') bytes.write(c);
        return bytes.toString("UTF-8");
    }

    @Override
    public void close() throws IOException {
        socket.close();
    }
}
