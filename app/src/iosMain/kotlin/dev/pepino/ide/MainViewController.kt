package dev.pepino.ide

import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController

@Suppress("ktlint:standard:function-naming", "FunctionNaming")
fun MainViewController(): UIViewController = ComposeUIViewController { App() }
