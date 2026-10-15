package dev.pepino.ide;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Spike #21 (spike branch only)
        System.setProperty("user.home", getFilesDir().getAbsolutePath());
        registerPlugin(GitSpikePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
