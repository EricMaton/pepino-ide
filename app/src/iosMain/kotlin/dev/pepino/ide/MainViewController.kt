package dev.pepino.ide

import androidx.compose.ui.window.ComposeUIViewController
import dev.pepino.ide.feature.projects.IosProjectSpace
import platform.UIKit.UIViewController

@Suppress("ktlint:standard:function-naming", "FunctionNaming")
fun MainViewController(): UIViewController = ComposeUIViewController { App(IosProjectSpace()) }
