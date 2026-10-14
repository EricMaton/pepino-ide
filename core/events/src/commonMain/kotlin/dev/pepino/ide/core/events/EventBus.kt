package dev.pepino.ide.core.events

import kotlin.reflect.KClass
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

class EventBus {
    private val channels = mutableMapOf<KClass<*>, MutableSharedFlow<Any>>()

    @Suppress("UNCHECKED_CAST")
    private fun <T : Any> channel(type: KClass<*>): MutableSharedFlow<T> =
        channels.getOrPut(type) { MutableSharedFlow(extraBufferCapacity = BUFFER_CAPACITY) }
            as MutableSharedFlow<T>

    fun <T : Any> events(type: KClass<T>): SharedFlow<T> = channel(type)

    suspend fun <T : Any> publish(event: T) {
        channel<T>(event::class).emit(event)
    }

    fun <T : Any> tryPublish(event: T): Boolean =
        channel<T>(event::class).tryEmit(event)

    companion object {
        private const val BUFFER_CAPACITY = 64
    }
}

inline fun <reified T : Any> EventBus.events(): SharedFlow<T> = events(T::class)
