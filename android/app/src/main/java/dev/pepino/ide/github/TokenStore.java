package dev.pepino.ide.github;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secrets (the GitHub token, #30; the AI assistant's key later, #58) kept
 * encrypted with AES-GCM under a key that lives in the Android Keystore and
 * never leaves it. Only the ciphertext reaches disk, in a preferences file
 * of its own. If the key is gone (a restored backup, a reset Keystore), what
 * cannot be decrypted is dropped: the user signs in again.
 */
public final class TokenStore {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "pepino.secrets";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;

    private final SharedPreferences prefs;

    public TokenStore(Context context) {
        prefs = context.getSharedPreferences("pepino.secrets", Context.MODE_PRIVATE);
    }

    public synchronized void save(String name, String secret) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] sealed = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
        if (!prefs.edit().putString(name, stored).commit()) throw new IllegalStateException("Cannot store the secret");
    }

    /** The secret, or null when there is none (or it can no longer be decrypted, and is dropped). */
    public synchronized String read(String name) {
        String stored = prefs.getString(name, null);
        if (stored == null) return null;
        try {
            int split = stored.indexOf(':');
            byte[] iv = Base64.decode(stored.substring(0, split), Base64.NO_WRAP);
            byte[] sealed = Base64.decode(stored.substring(split + 1), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(sealed), StandardCharsets.UTF_8);
        } catch (Exception e) {
            delete(name);
            return null;
        }
    }

    public synchronized void delete(String name) {
        prefs.edit().remove(name).commit();
    }

    /** The Keystore key, created on first use; it can encrypt and decrypt but never be read out. */
    private static SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }
}
