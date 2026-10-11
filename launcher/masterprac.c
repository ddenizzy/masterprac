/* MasterPrac.app's main executable. Starts Python inside this process so macOS treats it as a real app
 * "MasterPrac" (own name, icon, Dock entry, and its own Bluetooth / Spotify permissions) instead of "Python".
 * If MasterPrac is already open, it just brings the window to the front. */
#include <arpa/inet.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#if !defined(PYTHON_HOME) || !defined(APP_ROOT) || !defined(SITE_DIR)
#error "build with -DPYTHON_HOME=... -DAPP_ROOT=... -DSITE_DIR=..."
#endif

typedef int (*py_main_fn)(int, char **);

/* already open? ask it to show its window */
static int show_running(void) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return 0;
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons(5070);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int ok = connect(s, (struct sockaddr *)&a, sizeof a) == 0;
    if (ok) {
        const char *req = "POST /api/window/show HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n";
        write(s, req, strlen(req));
        char buf[64];
        read(s, buf, sizeof buf);
    }
    close(s);
    return ok;
}

int main(int argc, char **argv) {
    if (show_running()) return 0;

    chdir(APP_ROOT);
    setenv("PYTHONHOME", PYTHON_HOME, 1);
    setenv("PYTHONPATH", APP_ROOT ":" SITE_DIR, 1);
    setenv("PYTHONNOUSERSITE", "1", 1);
    setenv("PYTHONWARNINGS", "ignore", 1);

    int log = open(APP_ROOT "/data/run.log", O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (log >= 0) { dup2(log, 1); dup2(log, 2); close(log); }

    char lib[2048];
    snprintf(lib, sizeof lib, "%s/Python3", PYTHON_HOME);
    void *py = dlopen(lib, RTLD_NOW | RTLD_GLOBAL);
    if (!py) { fprintf(stderr, "masterprac: %s\n", dlerror()); return 1; }
    py_main_fn py_main = (py_main_fn)dlsym(py, "Py_BytesMain");
    if (!py_main) { fprintf(stderr, "masterprac: Py_BytesMain not found\n"); return 1; }

    /* python <argv0> main.py <args...>; skip macOS's -psn_ argument if present */
    char **pargv = calloc(argc + 2, sizeof *pargv);
    int n = 0;
    pargv[n++] = argv[0];
    pargv[n++] = APP_ROOT "/main.py";
    for (int i = 1; i < argc; i++)
        if (strncmp(argv[i], "-psn_", 5) != 0) pargv[n++] = argv[i];
    return py_main(n, pargv);
}
