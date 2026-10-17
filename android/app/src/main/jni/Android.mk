# The terminal's pseudo-terminal (#37): libpepino-pty.so, loaded by dev.pepino.ide.terminal.Pty
LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)
LOCAL_MODULE := pepino-pty
LOCAL_SRC_FILES := pty.c
LOCAL_CFLAGS := -std=gnu11 -Wall -Wextra -Werror -O2
include $(BUILD_SHARED_LIBRARY)
