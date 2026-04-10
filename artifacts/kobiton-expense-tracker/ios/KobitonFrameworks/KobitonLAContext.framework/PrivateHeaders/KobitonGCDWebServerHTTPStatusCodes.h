/*
 Copyright (c) 2012-2019, Pierre-Olivier Latour
 All rights reserved.
 
 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:
 * Redistributions of source code must retain the above copyright
 notice, this list of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright
 notice, this list of conditions and the following disclaimer in the
 documentation and/or other materials provided with the distribution.
 * The name of Pierre-Olivier Latour may not be used to endorse
 or promote products derived from this software without specific
 prior written permission.
 
 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 DISCLAIMED. IN NO EVENT SHALL PIERRE-OLIVIER LATOUR BE LIABLE FOR ANY
 DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
// http://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml

#import <Foundation/Foundation.h>

/**
 *  Convenience constants for "informational" HTTP status codes.
 */
typedef NS_ENUM(NSInteger, KobitonGCDWebServerInformationalHTTPStatusCode) {
  kKobitonGCDWebServerHTTPStatusCode_Continue = 100,
  kKobitonGCDWebServerHTTPStatusCode_SwitchingProtocols = 101,
  kKobitonGCDWebServerHTTPStatusCode_Processing = 102
};

/**
 *  Convenience constants for "successful" HTTP status codes.
 */
typedef NS_ENUM(NSInteger, KobitonGCDWebServerSuccessfulHTTPStatusCode) {
  kKobitonGCDWebServerHTTPStatusCode_OK = 200,
  kKobitonGCDWebServerHTTPStatusCode_Created = 201,
  kKobitonGCDWebServerHTTPStatusCode_Accepted = 202,
  kKobitonGCDWebServerHTTPStatusCode_NonAuthoritativeInformation = 203,
  kKobitonGCDWebServerHTTPStatusCode_NoContent = 204,
  kKobitonGCDWebServerHTTPStatusCode_ResetContent = 205,
  kKobitonGCDWebServerHTTPStatusCode_PartialContent = 206,
  kKobitonGCDWebServerHTTPStatusCode_MultiStatus = 207,
  kKobitonGCDWebServerHTTPStatusCode_AlreadyReported = 208
};

/**
 *  Convenience constants for "redirection" HTTP status codes.
 */
typedef NS_ENUM(NSInteger, KobitonGCDWebServerRedirectionHTTPStatusCode) {
  kKobitonGCDWebServerHTTPStatusCode_MultipleChoices = 300,
  kKobitonGCDWebServerHTTPStatusCode_MovedPermanently = 301,
  kKobitonGCDWebServerHTTPStatusCode_Found = 302,
  kKobitonGCDWebServerHTTPStatusCode_SeeOther = 303,
  kKobitonGCDWebServerHTTPStatusCode_NotModified = 304,
  kKobitonGCDWebServerHTTPStatusCode_UseProxy = 305,
  kKobitonGCDWebServerHTTPStatusCode_TemporaryRedirect = 307,
  kKobitonGCDWebServerHTTPStatusCode_PermanentRedirect = 308
};

/**
 *  Convenience constants for "client error" HTTP status codes.
 */
typedef NS_ENUM(NSInteger, KobitonGCDWebServerClientErrorHTTPStatusCode) {
  kKobitonGCDWebServerHTTPStatusCode_BadRequest = 400,
  kKobitonGCDWebServerHTTPStatusCode_Unauthorized = 401,
  kKobitonGCDWebServerHTTPStatusCode_PaymentRequired = 402,
  kKobitonGCDWebServerHTTPStatusCode_Forbidden = 403,
  kKobitonGCDWebServerHTTPStatusCode_NotFound = 404,
  kKobitonGCDWebServerHTTPStatusCode_MethodNotAllowed = 405,
  kKobitonGCDWebServerHTTPStatusCode_NotAcceptable = 406,
  kKobitonGCDWebServerHTTPStatusCode_ProxyAuthenticationRequired = 407,
  kKobitonGCDWebServerHTTPStatusCode_RequestTimeout = 408,
  kKobitonGCDWebServerHTTPStatusCode_Conflict = 409,
  kKobitonGCDWebServerHTTPStatusCode_Gone = 410,
  kKobitonGCDWebServerHTTPStatusCode_LengthRequired = 411,
  kKobitonGCDWebServerHTTPStatusCode_PreconditionFailed = 412,
  kKobitonGCDWebServerHTTPStatusCode_RequestEntityTooLarge = 413,
  kKobitonGCDWebServerHTTPStatusCode_RequestURITooLong = 414,
  kKobitonGCDWebServerHTTPStatusCode_UnsupportedMediaType = 415,
  kKobitonGCDWebServerHTTPStatusCode_RequestedRangeNotSatisfiable = 416,
  kKobitonGCDWebServerHTTPStatusCode_ExpectationFailed = 417,
  kKobitonGCDWebServerHTTPStatusCode_UnprocessableEntity = 422,
  kKobitonGCDWebServerHTTPStatusCode_Locked = 423,
  kKobitonGCDWebServerHTTPStatusCode_FailedDependency = 424,
  kKobitonGCDWebServerHTTPStatusCode_UpgradeRequired = 426,
  kKobitonGCDWebServerHTTPStatusCode_PreconditionRequired = 428,
  kKobitonGCDWebServerHTTPStatusCode_TooManyRequests = 429,
  kKobitonGCDWebServerHTTPStatusCode_RequestHeaderFieldsTooLarge = 431
};

/**
 *  Convenience constants for "server error" HTTP status codes.
 */
typedef NS_ENUM(NSInteger, KobitonGCDWebServerServerErrorHTTPStatusCode) {
  kKobitonGCDWebServerHTTPStatusCode_InternalServerError = 500,
  kKobitonGCDWebServerHTTPStatusCode_NotImplemented = 501,
  kKobitonGCDWebServerHTTPStatusCode_BadGateway = 502,
  kKobitonGCDWebServerHTTPStatusCode_ServiceUnavailable = 503,
  kKobitonGCDWebServerHTTPStatusCode_GatewayTimeout = 504,
  kKobitonGCDWebServerHTTPStatusCode_HTTPVersionNotSupported = 505,
  kKobitonGCDWebServerHTTPStatusCode_InsufficientStorage = 507,
  kKobitonGCDWebServerHTTPStatusCode_LoopDetected = 508,
  kKobitonGCDWebServerHTTPStatusCode_NotExtended = 510,
  kKobitonGCDWebServerHTTPStatusCode_NetworkAuthenticationRequired = 511
};
