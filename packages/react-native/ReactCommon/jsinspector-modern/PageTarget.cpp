/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "PageTarget.h"
#include "InspectorUtilities.h"
#include "PageAgent.h"
#include "Parsing.h"

#include <folly/dynamic.h>
#include <folly/json.h>

#include <memory>

namespace facebook::react::jsinspector_modern {

namespace {

/**
 * A Session connected to a PageTarget, passing CDP messages to and from a
 * PageAgent which it owns.
 */
class PageTargetSession {
 public:
  explicit PageTargetSession(
      std::unique_ptr<IRemoteConnection> remote,
      PageTarget::SessionMetadata sessionMetadata)
      : remote_(std::make_shared<RAIIRemoteConnection>(std::move(remote))),
        frontendChannel_(
            [remoteWeak = std::weak_ptr(remote_)](std::string_view message) {
              if (auto remote = remoteWeak.lock()) {
                remote->onMessage(std::string(message));
              }
            }),
        pageAgent_(frontendChannel_, std::move(sessionMetadata)) {}
  /**
   * Called by CallbackLocalConnection to send a message to this Session's
   * Agent.
   */
  void operator()(std::string message) {
    cdp::PreparsedRequest request;
    // Messages may be invalid JSON, or have unexpected types.
    try {
      request = cdp::preparse(message);
    } catch (const cdp::ParseError& e) {
      frontendChannel_(folly::toJson(folly::dynamic::object("id", nullptr)(
          "error",
          folly::dynamic::object("code", -32700)("message", e.what()))));
      return;
    } catch (const cdp::TypeError& e) {
      frontendChannel_(folly::toJson(folly::dynamic::object("id", nullptr)(
          "error",
          folly::dynamic::object("code", -32600)("message", e.what()))));
      return;
    }

    // Catch exceptions that may arise from accessing dynamic params during
    // request handling.
    try {
      pageAgent_.handleRequest(request);
    } catch (const cdp::TypeError& e) {
      frontendChannel_(folly::toJson(folly::dynamic::object("id", request.id)(
          "error",
          folly::dynamic::object("code", -32600)("message", e.what()))));
      return;
    }
  }

 private:
  // Owned by this instance, but shared (weakly) with the frontend channel
  std::shared_ptr<RAIIRemoteConnection> remote_;
  FrontendChannel frontendChannel_;
  PageAgent pageAgent_;
};

} // namespace

// @nocommit

/**
 * @cdp Runtime.enable is an interesting case
 */

// TODO: implement @cdp Runtime.enable

// @cdp Runtime.consoleAPICalled
std::unique_ptr<ILocalConnection> PageTarget::connect(
    std::unique_ptr<IRemoteConnection> connectionToFrontend,
    SessionMetadata sessionMetadata) {
  return std::make_unique<CallbackLocalConnection>(PageTargetSession(
      std::move(connectionToFrontend), std::move(sessionMetadata)));
}

} // namespace facebook::react::jsinspector_modern
