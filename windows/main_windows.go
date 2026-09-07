//go:build windows

// Vklad is a thin native WebView2 client. Team data stays on the HTTPS server.
package main

import (
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

func message(text string) {
	title, _ := syscall.UTF16PtrFromString("Вклад")
	body, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
}

func main() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	data, err := os.UserConfigDir()
	if err != nil {
		message("Не удалось открыть папку профиля пользователя.")
		return
	}
	data = filepath.Join(data, "Vklad", "WebView2")
	if err := os.MkdirAll(data, 0700); err != nil {
		message("Не удалось создать локальную папку настроек.")
		return
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug: false, AutoFocus: true, DataPath: data,
		WindowOptions: webview2.WindowOptions{Title: "Вклад · команда", Width: 1180, Height: 820, Center: true},
	})
	if w == nil {
		message("Для приложения требуется Microsoft Edge WebView2 Runtime. Установите его с сайта Microsoft. Команда также доступна в браузере: https://vklad.bezrabotnyi.com")
		return
	}
	defer w.Destroy()
	w.SetSize(760, 560, webview2.HintMin)
	// No native functions are exposed to the page; no screen, filesystem or shell bridge.
	w.Navigate("https://vklad.bezrabotnyi.com")
	w.Run()
}
