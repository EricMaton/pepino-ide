package dev.pepino.ide.github;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Secrets in the Android Keystore (#30): only ciphertext on disk, and a broken one is dropped. */
@RunWith(AndroidJUnit4.class)
public class TokenStoreDeviceTest {

    private static final String NAME = "test.secret";
    private static final String SECRET = "gho_device-test-secret";

    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final TokenStore store = new TokenStore(context);

    @After
    public void tearDown() {
        store.delete(NAME);
    }

    private SharedPreferences raw() {
        return context.getSharedPreferences("pepino.secrets", Context.MODE_PRIVATE);
    }

    @Test
    public void keepsTheSecretEncrypted() throws Exception {
        assertNull(store.read(NAME));
        store.save(NAME, SECRET);

        assertEquals(SECRET, new TokenStore(context).read(NAME));
        String onDisk = raw().getString(NAME, null);
        assertNotNull(onDisk);
        assertFalse("the secret is on disk in the clear", onDisk.contains(SECRET));
        assertFalse(onDisk.contains("gho_"));

        store.delete(NAME);
        assertNull(store.read(NAME));
    }

    @Test
    public void dropsWhatCannotBeDecrypted() throws Exception {
        store.save(NAME, SECRET);
        String onDisk = raw().getString(NAME, "");
        // One byte of the ciphertext changed: GCM's tag no longer matches. (Changing a base64
        // character is not enough: the last one before "=" has bits no byte uses.)
        int split = onDisk.indexOf(':');
        byte[] sealed = android.util.Base64.decode(onDisk.substring(split + 1), android.util.Base64.NO_WRAP);
        sealed[0] ^= 1;
        String broken = onDisk.substring(0, split + 1) + android.util.Base64.encodeToString(sealed, android.util.Base64.NO_WRAP);
        raw().edit().putString(NAME, broken).commit();

        assertNull(store.read(NAME));
        assertNull(raw().getString(NAME, null));
    }
}
