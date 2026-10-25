(() => {
    if (window.__myPackHookLoaded) {
        return;
    }
    window.__myPackHookLoaded = true;

    const OriginalXHR = window.XMLHttpRequest;
    const cartRequests = new Map();
    window.addEventListener("message", (event) => {
        if (
            (event.source !== window && event.source !== window.parent) ||
            event.origin !== window.location.origin ||
            event.data?.source !== "content-script" ||
            event.data.type !== "MYPACK_REFRESH_CART"
        ) return;

        for (const request of cartRequests.values()) {
            const xhr = new window.XMLHttpRequest();
            xhr.open(request.method, request.url);
            xhr._mypackCartRefresh = true;
            for (const [name, value] of request.headers) {
                xhr.setRequestHeader(name, value);
            }
            xhr.setRequestHeader("Cache-Control", "no-cache");
            xhr.send(request.body);
        }
    });
    const keywords = [
        "_getClassSearchResults",
        "_getShopCartTableData",
        "_getScheduleTableData",
        "_getScheduleCalEvents",
        "_getCustomCalEvents",
        "_getCustEventsTableData",
        "_getPlanTermTableData",
        "_getShopCartCalEvents",
        "IScript_getDegreeDetails",
        "IScript_getTermDetails",
    ];
    // Responses the content script parses itself, with the request URL.
    const rawTextKeywords = ["IScript_getDegreeDetails", "IScript_getTermDetails"];

    const receiverPromise = (function () {
        if (window.__receiverPromise) return window.__receiverPromise;

        return (window.__receiverPromise = new Promise((resolve) => {
            if (window.__receiverReady) return resolve(true);

            window.addEventListener("message", (ev) => {
                try {
                    if (
                        ev.source === window &&
                        ev.data?.type === "RECEIVER_READY" &&
                        ev.data.source === "content-script"
                    ) {
                        window.__receiverReady = true;
                        resolve(true);
                    }
                } catch (_) {
                    // ignore
                }
            });

            // Fallback resolve in case message is missed
            setTimeout(() => resolve(true), 2000);
        }));
    })();

    class InterceptedXHR extends OriginalXHR {
        open(method, url, ...rest) {
            this._url = String(url);
            this._method = method;
            this._headers = [];
            return super.open(method, url, ...rest);
        }

        setRequestHeader(name, value) {
            this._headers.push([name, value]);
            return super.setRequestHeader(name, value);
        }

        send(...args) {
            const cartType = ["_getShopCartTableData", "_getShopCartCalEvents"]
                .find((keyword) => this._url.includes(keyword));
            if (cartType && !this._mypackCartRefresh) {
                cartRequests.set(cartType, {
                    method: this._method,
                    url: this._url,
                    headers: this._headers,
                    body: args[0],
                });
            }
            this.addEventListener("load", async function () {
                try {
                    const matchedKeyword = keywords.find((keyword) =>
                        this._url.includes(keyword)
                    );
                    if (this.status < 200 || this.status >= 300) return;
                    if (matchedKeyword && rawTextKeywords.includes(matchedKeyword)) {
                        await receiverPromise;
                        window.postMessage(
                            {
                                source: "realFetchHook",
                                type: "CLASS_DATA",
                                payload: {
                                    data: this.responseText,
                                    responseType: matchedKeyword,
                                    // The plan or term is only named in the request URL.
                                    url: this._url,
                                },
                            },
                            window.location.origin !== "null"
                                ? window.location.origin
                                : "*"
                        );
                    } else if (matchedKeyword) {
                        let data = JSON.parse(this.responseText);
                        if (matchedKeyword === "_getClassSearchResults") {
                            data = data.data;
                        }
                        if (matchedKeyword === "_getCustEventsTableData") {
                            data = data.data;
                        }
                        if (matchedKeyword === "_getScheduleTableData") {
                            data = data.data;
                        }
                        if (matchedKeyword === "_getShopCartTableData") {
                            data = data.data;
                        }
                        if (matchedKeyword === "_getPlanTermTableData") {
                            data = data.data;
                        }

                        await receiverPromise;
                        window.postMessage(
                            {
                                source: "realFetchHook",
                                type: "CLASS_DATA",
                                payload: {
                                    data: data,
                                    responseType: matchedKeyword,
                                    ...(this._mypackCartRefresh ? { fullSnapshot: true } : {}),
                                },
                            },
                            // "null" origins (sandboxed/about:blank) can't be targeted.
                            window.location.origin !== "null"
                                ? window.location.origin
                                : "*"
                        );
                    }
                } catch (err) {
                    // Silently fail without logging
                }
            });

            return super.send(...args);
        }
    }

    window.XMLHttpRequest = InterceptedXHR;
})();
