'use-strict';

const debug = require('debug')('bravia:request');
const got = require('got');
const parseString = require('xml2js').parseStringPromise;

exports.request = async (uri, credentials, data, headers) => {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPACTION: '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
    },
  };

  if (data.xml) {
    options.body = data.xml;
    options.responseType = 'text';
  } else {
    options.json = data;
    options.responseType = 'json';
  }

  if (credentials.psk) {
    options.headers['X-Auth-PSK'] = credentials.psk;
  } else if (credentials.pin && credentials.pin.token) {
    options.headers.Cookie = `auth=${credentials.pin.token}`;
  }

  options.headers = {
    ...options.headers,
    ...headers,
  };

  debug(`Initializing request for ${uri}`);
  debug('Request %O', options);

  try {
    const response = await got(uri, options);
    response.body.turnedOff = null;

    //The “error” member must be an array and is defined as [error_code, error_message].
    //Error List: https://pro-bravia.sony.net/develop/integrate/rest-api/spec/errorcode-list/index.html
    const error = response.body.error;

    if (error) {
      if (error[1] === 'Illegal State') {
        response.body.result = [
          {
            uri: false,
            source: 'application',
            title: 'Application',
          },
        ];

        delete response.body.error;
      } else if (error[0] === 40005 || error[1] === 'Display Is Turned off' || error[1] === 'not power-on') {
        response.body.result = error;
        response.body.turnedOff = true;

        delete response.body.error;
      } else {
        throw new Error(error);
      }
    }

    //If a request succeeds, “error” is ignored in the response. However, if a request fails, “result” is skipped.
    if (response.statusCode !== 200) {
      try {
        const result = await parseString(response.body);
        try {
          throw new Error(
            result['s:Envelope']['s:Body'][0]['s:Fault'][0]['detail'][0]['UPnPError'][0]['errorDescription'][0]
          );
        } catch (err) {
          throw new Error(`Unexpected or malformed error response: ${result}.`);
        }
      } catch (err) {
        throw new Error(`Failed to parse the error response: ${response.body}.`);
      }
    }

    //"response.body.result" must be an array type of fixed length. (The length is defined on each API specification.)
    return response;
  } catch (err) {
    if (err.response) {
      const error = new Error(`${err.response.statusCode} - ${err.response.statusCode}`);

      Object.assign(error, {
        title: 'Invalid Response',
        code: err.response.statusCode,
        message: err.response.statusMessage,
        url: err.response.url,
        headers: err.response.headers,
      });

      throw error;
    } else if (err.request) {
      const error = new Error(`${err.message} - ${err.code}`);

      Object.assign(error, {
        title: 'No Response',
        code: err.code,
        message: err.message,
        url: err.request.requestUrl,
      });

      throw error;
    } else {
      throw new Error(err);
    }
  }
};