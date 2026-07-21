package io.github.ghiloufibg.flowable.rest.dto;

import java.time.Instant;

/** Mirrors the frontend's {@code jobHealth()} return shape (frontend/src/lib/store.ts). */
public record JobHealthDto(
    long timers,
    long async,
    long dead,
    long locked,
    Instant nextTimerDue,
    Instant oldestAsyncCreated) {}
