package io.ghiloufi.flowable.web;

import java.io.IOException;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Falls back to {@code index.html} for any path that doesn't resolve to a real static asset, so
 * client-side routes (e.g. a deep-linked instance detail page) load the SPA shell instead of a 404
 * - the client-side router then takes over from the URL. Delegates existence/security checking to
 * the parent implementation (path-traversal protection, allowed-locations validation) rather than
 * reimplementing it.
 */
public class SpaResourceResolver extends PathResourceResolver {

  private final Resource indexHtml;

  public SpaResourceResolver(Resource indexHtml) {
    this.indexHtml = indexHtml;
  }

  @Override
  protected Resource getResource(String resourcePath, Resource location) throws IOException {
    // A bare mount-root request (e.g. "/flow-trace/") resolves to an empty relative path, which
    // the parent implementation can throw IOException for rather than cleanly returning null -
    // fall back to index.html either way, not just on a null return.
    try {
      Resource resource = super.getResource(resourcePath, location);
      return resource != null ? resource : indexHtml;
    } catch (IOException e) {
      return indexHtml;
    }
  }
}
