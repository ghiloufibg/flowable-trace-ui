package io.github.ghiloufibg.flowable.rest;

/**
 * Shared by {@link InstanceEnrichmentController} and {@link JobEnrichmentController}: Flowable only
 * exposes the exception message on its public API, not the exception class, so both heuristically
 * parse it from the first line of the stack trace (Java convention: {@code
 * "fully.qualified.Exception: message"}).
 */
final class StackTraces {

  private StackTraces() {}

  static String extractExceptionClass(String stackTrace) {
    if (stackTrace == null || stackTrace.isBlank()) {
      return null;
    }
    String firstLine = stackTrace.lines().findFirst().orElse("");
    int colonIndex = firstLine.indexOf(':');
    return colonIndex > 0 ? firstLine.substring(0, colonIndex).trim() : firstLine.trim();
  }
}
