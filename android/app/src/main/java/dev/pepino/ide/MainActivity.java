package dev.pepino.ide;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.pepino.ide.git.GitPlugin;
import dev.pepino.ide.github.GitHubPlugin;
import dev.pepino.ide.terminal.TerminalPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // JGit reads the user's git config from the home folder; Android has none, so it is the app's own.
        System.setProperty("user.home", getFilesDir().getAbsolutePath());
        registerPlugin(GitPlugin.class);
        registerPlugin(GitHubPlugin.class);
        registerPlugin(TerminalPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
