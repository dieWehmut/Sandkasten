package dev.sandkasten.mobile;

import static org.junit.Assert.*;

import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Saved-device recovery through the installed app's real native HTTP bridge. */
@RunWith(AndroidJUnit4.class)
public class SavedDeviceReconnectTest {
    private static final String TOKEN = "native-reconnect-fixture-token";
    private static final String PROJECT_ID = "native-reconnect-project";
    private static final String PROJECT_NAME = "Native reconnect project";
    private static final String JOB_ID = "native-reconnect-job";
    private static final String SOURCE = "package main\nfunc main() {}\n";
    private static final String OUTPUT = "output restored after native reconnect";

    @Test
    public void savedWorkbenchAndSelectedOutputRecoverAfterTemporaryStartupFailure() throws Exception {
        try (RecoveryServer server = new RecoveryServer();
             ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            JSONObject previousStorage = null;
            JSONObject previousCredential = null;
            String credentialKey = "sandkasten.token:" + server.address();
            String historyKey = "sandkasten.jobs:" + server.address();
            try {
                awaitBridge(app);
                JSONArray keys = new JSONArray(Arrays.asList("sandkasten.devices", "sandkasten.projects", "sandkasten.panels", historyKey));
                previousStorage = new JSONObject(evaluate(app,
                    "Object.fromEntries(" + keys + ".map(key => [key, localStorage.getItem(key)]))"));
                previousCredential = call(app, "Capacitor.Plugins.Credentials.get({key:" + JSONObject.quote(credentialKey) + "})");
                call(app, "Capacitor.Plugins.Credentials.set({key:" + JSONObject.quote(credentialKey)
                    + ",value:" + JSONObject.quote(TOKEN) + "})");

                JSONObject project = new JSONObject().put("id", PROJECT_ID).put("name", PROJECT_NAME)
                    .put("language", "go").put("source", SOURCE).put("entrypoint", "main.go")
                    .put("stdin", "").put("args", "[]").put("files", new JSONArray()).put("runTimeoutMs", 0);
                JSONObject history = new JSONObject().put("jobId", JOB_ID).put("status", "JOB_STATUS_SUCCEEDED")
                    .put("projectId", PROJECT_ID).put("projectName", PROJECT_NAME).put("language", "go").put("submittedAt", 1);
                JSONObject storage = new JSONObject()
                    .put("sandkasten.devices", new JSONArray().put(new JSONObject().put("address", server.address()).put("name", "Native recovery device")).toString())
                    .put("sandkasten.projects", new JSONArray().put(project).toString())
                    .put("sandkasten.panels", new JSONArray().put(new JSONObject().put("hostAddress", server.address())
                        .put("projectId", PROJECT_ID).put("selectedJobId", JOB_ID)).toString())
                    .put(historyKey, new JSONArray().put(history).toString());
                evaluate(app, "Object.entries(" + storage + ").forEach(([key,value]) => localStorage.setItem(key,value)); void 0");

                app.recreate();
                awaitBridge(app);
                assertTrue("The restored device did not request its native catalog", server.firstCatalog.await(10, TimeUnit.SECONDS));
                server.assertHealthy();
                assertEquals("The initial catalog read must still be pending", 1, server.catalogReads.get());
                assertEquals("\"connecting\"", evaluate(app, "document.querySelector('.connection-badge')?.dataset.status"));
                evaluate(app, "document.querySelectorAll('nav[aria-label=主导航] button')[1].click(); void 0");
                awaitJavascript(app, server,
                    "document.querySelectorAll('.workbench').length === 1 && document.querySelector('.workbench h2')?.textContent === "
                        + JSONObject.quote(PROJECT_NAME),
                    "Saved workbench was not restored while the native catalog request was pending");
                assertEquals(JSONObject.quote(SOURCE), evaluate(app, "document.querySelector('.workbench .source-editor')?.value"));
                evaluate(app, "document.querySelectorAll('.workbench .pane-tabs button')[1].click(); void 0");
                awaitJavascript(app, server,
                    "document.querySelector('.workbench .task-summary .project-path')?.textContent.includes(" + JSONObject.quote(JOB_ID) + ") === true",
                    "Saved terminal task selection was not restored offline");
                assertEquals("0", evaluate(app, "document.querySelectorAll('.workbench .source-output').length"));

                // Release the first 503 only after inspecting the offline UI. This
                // avoids depending on how quickly the emulator draws its launch screen.
                server.releaseInitialFailure.countDown();
                awaitJavascript(app, server,
                    "document.querySelector('.workbench .source-output')?.textContent === " + JSONObject.quote(OUTPUT),
                    "Saved output did not recover automatically after two temporary HTTP failures");
                assertEquals(JSONObject.quote(JOB_ID), evaluate(app,
                    "JSON.parse(localStorage.getItem('sandkasten.panels'))[0].selectedJobId"));
                evaluate(app, "document.querySelectorAll('nav[aria-label=主导航] button')[0].click(); void 0");
                awaitJavascript(app, server,
                    "document.querySelector('.connection-badge')?.dataset.status === 'connected' && document.querySelector('.runtime-catalog')?.textContent.includes('native-reconnect') === true",
                    "The device status and runtime catalog did not recover");
                server.assertHealthy();
                assertEquals(3, server.catalogReads.get());
                assertEquals(1, server.jobReads.get());
                assertEquals(Arrays.asList("GET /v1/runtimes", "GET /v1/runtimes", "GET /v1/runtimes", "GET /v1/jobs/" + JOB_ID), server.recordedRequests());
            } finally {
                // Close accepted sockets and release the fixture even when the
                // offline assertion fails, then destroy any pending retry controller.
                server.close();
                try {
                    if (previousCredential != null) {
                        call(app, previousCredential.isNull("value")
                            ? "Capacitor.Plugins.Credentials.remove({key:" + JSONObject.quote(credentialKey) + "})"
                            : "Capacitor.Plugins.Credentials.set({key:" + JSONObject.quote(credentialKey)
                                + ",value:" + JSONObject.quote(previousCredential.getString("value")) + "})");
                    }
                } finally {
                    if (previousStorage != null) {
                        evaluate(app, "Object.entries(" + previousStorage + ").forEach(([key,value]) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key,value)); void 0");
                        app.recreate();
                        awaitBridge(app);
                    }
                }
            }
        }
    }

    private void awaitJavascript(ActivityScenario<MainActivity> app, RecoveryServer server, String condition, String message) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15000;
        while (SystemClock.elapsedRealtime() < deadline) {
            server.assertHealthy();
            if (evaluate(app, "Boolean(" + condition + ")").equals("true")) return;
            SystemClock.sleep(100);
        }
        server.assertHealthy();
        fail(message + "; requests=" + server.recordedRequests());
    }

    private void awaitBridge(ActivityScenario<MainActivity> app) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (evaluate(app, "Boolean(window.Capacitor?.Plugins?.Credentials && window.Capacitor?.Plugins?.Appearance && window.Capacitor?.Plugins?.CapacitorHttp && document.querySelector('#app')?.textContent && !document.querySelector('.launch-screen') && document.documentElement.dataset.appearanceReady === 'true')").equals("true")) return;
            SystemClock.sleep(100);
        }
        fail("Packaged app did not register its native bridge within 30 seconds");
    }

    private JSONObject call(ActivityScenario<MainActivity> app, String expression) throws Exception {
        evaluate(app, "window.__reconnectQaResult = undefined; Promise.resolve().then(() => (" + expression
            + ")).then(value => {window.__reconnectQaResult = {ok:true,value:value ?? {}}}, error => {window.__reconnectQaResult = {ok:false,error:String(error)}}); void 0");
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (SystemClock.elapsedRealtime() < deadline) {
            String result = evaluate(app, "window.__reconnectQaResult ?? null");
            if (!result.equals("null")) {
                JSONObject parsed = new JSONObject(result);
                assertTrue("Native bridge rejected: " + parsed.optString("error"), parsed.getBoolean("ok"));
                return parsed.getJSONObject("value");
            }
            SystemClock.sleep(100);
        }
        throw new AssertionError("Native bridge call timed out");
    }

    private String evaluate(ActivityScenario<MainActivity> app, String script) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        app.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            completed.countDown();
        }));
        assertTrue("WebView JavaScript timed out", completed.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private static final class RecoveryServer implements AutoCloseable {
        final AtomicInteger catalogReads = new AtomicInteger();
        final AtomicInteger jobReads = new AtomicInteger();
        final CountDownLatch firstCatalog = new CountDownLatch(1);
        final CountDownLatch releaseInitialFailure = new CountDownLatch(1);
        private final ServerSocket server;
        private final Thread worker;
        private final AtomicReference<Throwable> failure = new AtomicReference<>();
        private final List<String> requests = Collections.synchronizedList(new ArrayList<>());
        private volatile boolean closed;
        private volatile Socket active;

        RecoveryServer() throws Exception {
            server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
            server.setSoTimeout(1000);
            worker = new Thread(() -> {
                try {
                    while (!closed) {
                        try (Socket socket = server.accept()) {
                            active = socket;
                            socket.setSoTimeout(5000);
                            handle(socket);
                        } catch (SocketTimeoutException timeout) {
                            if (active != null) throw timeout;
                        } finally { active = null; }
                    }
                } catch (Throwable cause) {
                    if (!closed) failure.compareAndSet(null, cause);
                }
            }, "native-reconnect-http");
            worker.setDaemon(true);
            worker.start();
        }

        String address() { return "http://127.0.0.1:" + server.getLocalPort(); }
        List<String> recordedRequests() { synchronized (requests) { return new ArrayList<>(requests); } }
        void assertHealthy() {
            Throwable cause = failure.get();
            if (cause != null) throw new AssertionError("Reconnect HTTP fixture failed; requests=" + recordedRequests(), cause);
        }

        private void handle(Socket socket) throws Exception {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String requestLine = reader.readLine();
            assertNotNull("Missing request line", requestLine);
            String[] parts = requestLine.split(" ");
            assertEquals("Malformed request line", 3, parts.length);
            requests.add(parts[0] + " " + parts[1]);
            assertTrue("Unexpected request loop", requests.size() <= 8);
            assertEquals("Reconnecting must never replay a write", "GET", parts[0]);
            String authorization = null;
            int headerCount = 0;
            for (String line; (line = reader.readLine()) != null && !line.isEmpty();) {
                assertTrue("Too many request headers", ++headerCount <= 64);
                if (line.toLowerCase(Locale.ROOT).startsWith("authorization:")) authorization = line.substring(line.indexOf(':') + 1).trim();
            }
            assertEquals("Bearer " + TOKEN, authorization);
            if (parts[1].equals("/v1/runtimes")) {
                int read = catalogReads.incrementAndGet();
                firstCatalog.countDown();
                assertTrue("Catalog retried after successful recovery", read <= 3);
                if (read == 1) assertTrue("Offline UI inspection did not release the first response", releaseInitialFailure.await(30, TimeUnit.SECONDS));
                respond(socket, read <= 2 ? 503 : 200, read <= 2
                    ? "{\"message\":\"fixture temporarily offline\"}"
                    : "{\"runtimes\":[{\"language\":\"go\",\"status\":\"active\",\"default_entrypoint\":\"main.go\",\"version\":\"native-reconnect\"}]}");
            } else if (parts[1].equals("/v1/jobs/" + JOB_ID)) {
                assertEquals("History output read more than once", 1, jobReads.incrementAndGet());
                respond(socket, 200, new JSONObject().put("jobId", JOB_ID).put("status", "JOB_STATUS_SUCCEEDED")
                    .put("language", "go").put("outputReady", true).put("stdout", OUTPUT).toString());
            } else {
                fail("Unexpected reconnect request: " + requestLine);
            }
        }

        private void respond(Socket socket, int status, String text) throws Exception {
            byte[] body = text.getBytes(StandardCharsets.UTF_8);
            String response = "HTTP/1.1 " + status + (status == 200 ? " OK" : " Service Unavailable")
                + "\r\nContent-Type: application/json\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
            socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
            socket.getOutputStream().write(body);
            socket.getOutputStream().flush();
        }

        @Override public void close() throws Exception {
            if (closed) return;
            closed = true;
            releaseInitialFailure.countDown();
            Socket socket = active;
            if (socket != null) socket.close();
            server.close();
            worker.join(2000);
            assertFalse("Reconnect HTTP fixture did not stop", worker.isAlive());
        }
    }
}
