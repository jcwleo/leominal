# Leominal Performance Bottleneck Review

Date: 2026-05-19

## Scope

This note summarizes the latency and performance bottleneck review for Leominal, a single Node.js server that serves a React/xterm browser UI and connects it to real host PTYs through `node-pty`.

The review focused on:

- first-load and reconnect latency
- terminal output throughput
- pane resize and layout persistence cost
- server-side helper costs on the terminal hot path
- current evidence from build output, runtime headers, and small local measurements

## Summary

The basic HTTP/API routing path is not the main bottleneck. On the currently running local service, loopback checks were fast:

- `/`: TTFB about `7.5ms`
- `/api/auth/session`: TTFB about `8.3ms`

The higher-impact optimization areas are:

1. static asset size, caching, and compression
2. terminal WebSocket output backpressure and batching
3. reconnect snapshot replay cost
4. resize/fit event frequency
5. pane drag layout persistence
6. macOS `cwd` resolution through `lsof`

## Evidence Collected

### Build Output

`npm run build` completed successfully. Vite warned about a large client chunk:

- JS bundle: `576.92KB`, gzip estimate `160.34KB`
- CSS: `26.11KB`, gzip estimate `5.43KB`
- MesloLGS NF regular font: `1.29MB`
- MesloLGS NF bold font: `1.30MB`
- MesloLGS NF italic font: `1.25MB`
- MesloLGS NF bold italic font: `1.26MB`

The bundled fonts add roughly `5MB` of raw static assets.

### Runtime Static Headers

The running service served hashed assets with:

```text
cache-control: public, max-age=0
content-encoding: absent
```

This means the browser must revalidate hashed JS/CSS/font assets and receives raw payloads from the Node server even when the request includes `Accept-Encoding: gzip, br`.

### Local Helper Cost Samples

On this machine:

- macOS `lsof` cwd lookup averaged about `18ms`, max about `22.1ms` over 10 samples.
- `scrypt` password hashing averaged about `29.2ms`, max about `32.3ms` over 10 samples.
- a synthetic 31KB layout-state write averaged about `0.33ms`.

The `scrypt` cost is acceptable for login/setup because it is not on the normal terminal interaction path.

## Findings

### 1. Static Asset Delivery Is The Highest-Confidence First-Load Bottleneck

Relevant paths:

- `src/server/http.ts`
- `src/client/main.tsx`
- `src/client/auth/AuthGate.tsx`
- `src/client/terminal/fonts.css`
- `vite.config.ts`

The current app imports xterm, terminal UI, and bundled fonts from the initial client entry. `AuthGate` statically imports `TerminalWorkspace`, so even the login screen pays for the terminal workspace code path.

The served assets are content-hashed, but the server returns `max-age=0`. The same JS/font files are also not precompressed by the app server.

Recommended improvements:

- Serve `/assets/*` with `Cache-Control: public, max-age=31536000, immutable`.
- Keep `index.html` as `no-cache` or short-lived.
- Add gzip or brotli for JS/CSS, either through reverse proxy or static precompression.
- Convert bundled TTF fonts to WOFF2.
- Consider subsetting MesloLGS NF if the full Nerd Font glyph range is not needed.
- Lazy-load the terminal workspace after authentication so login/setup does not fetch xterm and terminal code immediately.

Expected impact:

- largest improvement for first load over VPN, tunnel, iPad, or weak networks
- lower repeated-load latency because hashed assets can be cached long-term

### 2. Terminal WebSocket Output Has No Backpressure Guard

Relevant paths:

- `src/server/terminal/TerminalManager.ts`
- `src/server/routes/terminalWebSocket.ts`
- `src/client/terminal/XtermPane.tsx`

PTY output is published immediately to every subscriber. The WebSocket send path serializes every message and sends it without checking socket pressure, send callback latency, or `bufferedAmount`.

This is fine for normal interactive shell use, but high-output commands such as large `cat`, build logs, `rg` over large trees, or multiple subscribed clients can cause:

- server-side memory growth in slow-client scenarios
- event-loop pressure from frequent JSON serialization
- client-side render pressure from many small `xterm.write(...)` calls

Recommended improvements:

- Batch terminal output over a short interval, for example one flush per event loop tick or animation frame.
- Track `socket.bufferedAmount` and disconnect or throttle clients that stay above a threshold.
- Send larger coalesced output chunks instead of one WebSocket frame per PTY data event.
- On the client, batch incoming output and flush to `xterm.write(...)` through `requestAnimationFrame` or xterm write callbacks.

Expected impact:

- better behavior under high-output commands
- less latency jitter for interactive input while output is streaming
- lower risk of slow remote clients degrading the server

### 3. Reconnect Snapshot Replay Can Become Expensive

Relevant paths:

- `src/server/terminal/outputBuffer.ts`
- `src/server/routes/terminalWebSocket.ts`
- `src/client/terminal/XtermPane.tsx`

Each terminal keeps the last `500` output chunks. On WebSocket attach, the server sends a snapshot containing the full buffered chunk array. The client then clears xterm and writes each chunk one by one.

The cap is chunk-count based, not byte-count based. A small number of large chunks can still produce a large reconnect payload.

Recommended improvements:

- Cap the server output buffer by total bytes, not only chunk count.
- Coalesce snapshot output into one string or fewer chunks before sending.
- Consider reducing server replay size if xterm scrollback already covers enough local history.
- Measure snapshot size and replay duration in reconnect tests.

Expected impact:

- faster refresh/reconnect for terminals with large recent output
- lower memory and serialization pressure

### 4. Resize/Fit Handling Is Aggressive

Relevant path:

- `src/client/terminal/XtermPane.tsx`

Each xterm pane has listeners for `ResizeObserver`, `window.resize`, `visualViewport.resize`, `visualViewport.scroll`, `pageshow`, and `visibilitychange`. A settled fit schedules four attempts at `0ms`, `50ms`, `150ms`, and `350ms`.

Each fit calls:

- `fit.fit()`
- `xterm.refresh(0, rows - 1)`
- a WebSocket resize message when dimensions changed

This helps iPad/mobile correctness, but it can become expensive when many panes are mounted, when visual viewport events are noisy, or during split resizing.

Recommended improvements:

- Run global viewport listeners only for active or visible panes.
- Coalesce all fit requests through one `requestAnimationFrame` queue.
- Avoid `xterm.refresh(...)` unless a real redraw is needed.
- Keep the multi-delay settled fit only for known mobile viewport transitions.

Expected impact:

- smoother pane resizing
- less redundant work on mobile viewport changes
- lower CPU when many panes exist

### 5. Pane Drag Persists Layout Too Often

Relevant paths:

- `src/client/terminal/SplitPane.tsx`
- `src/client/terminal/TerminalWorkspace.tsx`
- `src/client/terminal/terminalReducer.ts`

The split divider calls `onResize(...)` on every pointer move. That dispatches a layout change, serializes layout state, and writes it to localStorage immediately. Server persistence is debounced by `75ms`, but localStorage is synchronous.

This is probably fine for small layouts, but pane drag can become less smooth with many tabs/workspaces or slower devices.

Recommended improvements:

- During drag, update visual ratio state without persisting every pointer move.
- Persist the final ratio on pointerup.
- Alternatively, throttle localStorage writes with `requestAnimationFrame` or a larger debounce.

Expected impact:

- smoother divider dragging
- less synchronous storage work during pointer movement

### 6. macOS cwd Resolution Uses `lsof`

Relevant paths:

- `src/server/terminal/cwdResolver.ts`
- `src/server/terminal/TerminalManager.ts`
- `src/server/routes/uploadRoutes.ts`

On macOS, resolving a PTY process cwd runs:

```text
lsof -a -p <pid> -d cwd -Fn
```

The local sample averaged about `18ms`. This is not part of every keystroke, but it is used when creating a split from a parent terminal and before uploads.

Recommended improvements:

- For split creation, consider using the cached terminal summary cwd first and updating later.
- Keep upload cwd resolution accurate because files must land in the actual active cwd.
- Longer-term, consider shell integration such as OSC 7 to keep cwd updated without spawning `lsof`.

Expected impact:

- slightly faster split creation on macOS
- less subprocess overhead

## Lower Priority Notes

### Login Hashing

`scrypt` averaged about `29ms` locally. This is acceptable because it only affects login/setup and provides useful password-hardening cost.

### Upload Path Planning

Uploads stream file contents, which is good for large files. The main possible cost is path planning for many files because collision checks call filesystem access serially. This is only worth optimizing if large folder drops feel slow before upload starts.

Relevant paths:

- `src/server/uploads/uploadPaths.ts`
- `src/server/uploads/uploadService.ts`
- `src/client/terminal/uploadDrop.ts`

## Suggested Implementation Order

1. Add cache headers for hashed static assets and keep HTML short-lived.
2. Add gzip/brotli support through the deployment boundary or precompressed static files.
3. Convert terminal fonts from TTF to WOFF2 and only load the weights/styles actually needed.
4. Lazy-load terminal workspace code after authentication.
5. Add server-side WebSocket output batching and slow-client backpressure protection.
6. Add client-side xterm output batching.
7. Change reconnect snapshot from chunk-count cap to byte cap.
8. Coalesce resize/fit scheduling and limit global listeners to active/visible panes.
9. Persist split ratios on pointerup instead of every pointermove.
10. Optimize macOS cwd resolution only if split/upload latency is observed in practice.

## Verification Gaps

This review did not include:

- remote VPN/tunnel browser performance profile
- iPad Safari timeline capture
- authenticated high-output WebSocket stress test
- before/after Lighthouse or WebPageTest-style measurements

Those checks should be added before claiming a specific latency reduction.
