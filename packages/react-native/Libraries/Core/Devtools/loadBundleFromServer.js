/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @oncall react_native
 */

import Networking from '../../Network/RCTNetworking';
import HMRClient from '../../Utilities/HMRClient';
import LoadingView from '../../Utilities/LoadingView';
import getDevServer from './getDevServer';

declare var global: {globalEvalWithSourceUrl?: (string, string) => mixed, ...};

let pendingRequests = 0;

function asyncRequest(
  url: string,
): Promise<{body: string, headers: {[string]: string}}> {
  let id = null;
  let responseText = null;
  let headers = null;
  let dataListener;
  let completeListener;
  let responseListener;
  return new Promise<{body: string, headers: {[string]: string}}>(
    (resolve, reject) => {
      dataListener = Networking.addListener(
        'didReceiveNetworkData',
        ([requestId, response]) => {
          if (requestId === id) {
            responseText = response;
          }
        },
      );
      responseListener = Networking.addListener(
        'didReceiveNetworkResponse',
        ([requestId, status, responseHeaders]) => {
          if (requestId === id) {
            headers = responseHeaders;
          }
        },
      );
      completeListener = Networking.addListener(
        'didCompleteNetworkResponse',
        ([requestId, error]) => {
          if (requestId === id) {
            if (error) {
              reject(error);
            } else {
              //$FlowFixMe[incompatible-call]
              resolve({body: responseText, headers});
            }
          }
        },
      );
      Networking.sendRequest(
        'GET',
        'asyncRequest',
        url,
        {},
        '',
        'text',
        false,
        0,
        requestId => {
          id = requestId;
        },
        true,
      );
    },
  ).finally(() => {
    dataListener && dataListener.remove();
    completeListener && completeListener.remove();
    responseListener && responseListener.remove();
  });
}

function buildUrlForBundle(bundlePathAndQuery: string) {
  const {url: serverUrl} = getDevServer();
  return (
    serverUrl.replace(/\/+$/, '') + '/' + bundlePathAndQuery.replace(/^\/+/, '')
  );
}

module.exports = function (bundlePathAndQuery: string): Promise<void> {
  const requestUrl = buildUrlForBundle(bundlePathAndQuery);

  LoadingView.showMessage('Downloading...', 'load');
  ++pendingRequests;
  return asyncRequest(requestUrl)
    .then<void>(({body, headers}) => {
      if (
        headers['Content-Type'] != null &&
        headers['Content-Type'].indexOf('application/json') >= 0
      ) {
        // Errors are returned as JSON.
        throw new Error(
          JSON.parse(body).message ||
            `Unknown error fetching '${bundlePathAndQuery}'`,
        );
      }

      HMRClient.registerBundle(requestUrl);

      // Some engines do not support `sourceURL` as a comment. We expose a
      // `globalEvalWithSourceUrl` function to handle updates in that case.
      if (global.globalEvalWithSourceUrl) {
        global.globalEvalWithSourceUrl(body, requestUrl);
      } else {
        // eslint-disable-next-line no-eval
        eval(body);
      }
    })
    .finally(() => {
      if (!--pendingRequests) {
        LoadingView.hide();
      }
    });
};
