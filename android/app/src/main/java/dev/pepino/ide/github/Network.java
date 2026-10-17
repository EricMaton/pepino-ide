package dev.pepino.ide.github;

import java.io.EOFException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLHandshakeException;

/**
 * Connection failures (#36), for the GitHub calls and git alike: whether a
 * failure is the connection's rather than GitHub's answer, and how to say
 * which one it is, so the user knows whether to wait, move or retry.
 */
public final class Network {

    private Network() {}

    /** The plain words for a connection failure somewhere in [e]'s causes; null when it is not one. */
    public static String describe(Throwable e) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof UnknownHostException) return "No internet connection";
            if (cause instanceof SocketTimeoutException) return "GitHub is taking too long to answer: the connection may be slow";
            if (cause instanceof SSLHandshakeException) {
                return "Cannot reach GitHub securely: the Wi-Fi may need you to sign in to it first";
            }
            // Refused, no route, reset, cut halfway
            if (cause instanceof SocketException || cause instanceof SSLException || cause instanceof EOFException) {
                return "The connection to GitHub dropped";
            }
            if (cause.getCause() == cause) break;
        }
        return null;
    }
}
