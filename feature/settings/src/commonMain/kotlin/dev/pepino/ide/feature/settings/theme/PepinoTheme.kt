package dev.pepino.ide.feature.settings.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val PepinoBlack = Color(0xFF0A0A0A)
val PepinoPanel = Color(0xFF161616)
val PepinoWhite = Color(0xFFF2F2F2)
val PepinoRed = Color(0xFFE10600)
val PepinoGrey = Color(0xFF8A8A8A)

private val BrutalistColorScheme =
    darkColorScheme(
        primary = PepinoRed,
        onPrimary = PepinoWhite,
        primaryContainer = PepinoRed,
        onPrimaryContainer = PepinoWhite,
        secondary = PepinoWhite,
        onSecondary = PepinoBlack,
        background = PepinoBlack,
        onBackground = PepinoWhite,
        surface = PepinoBlack,
        onSurface = PepinoWhite,
        surfaceVariant = PepinoPanel,
        onSurfaceVariant = PepinoWhite,
        error = PepinoRed,
        onError = PepinoWhite,
        outline = PepinoGrey,
    )

private val BrutalistShapes =
    Shapes(
        extraSmall = RoundedCornerShape(0.dp),
        small = RoundedCornerShape(0.dp),
        medium = RoundedCornerShape(0.dp),
        large = RoundedCornerShape(0.dp),
        extraLarge = RoundedCornerShape(0.dp),
    )

val PepinoTypography =
    Typography(
        headlineLarge =
            TextStyle(
                fontWeight = FontWeight.Black,
                fontSize = 32.sp,
                letterSpacing = (-0.5).sp,
            ),
        titleLarge =
            TextStyle(
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                letterSpacing = 1.sp,
            ),
        labelLarge =
            TextStyle(
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                letterSpacing = 1.5.sp,
            ),
        bodyMedium =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                letterSpacing = 0.25.sp,
            ),
    )

@Composable
fun PepinoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = BrutalistColorScheme,
        shapes = BrutalistShapes,
        typography = PepinoTypography,
        content = content,
    )
}
