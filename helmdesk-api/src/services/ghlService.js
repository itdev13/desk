const axios = require('axios');
const logger = require('../utils/logger');
const OAuthToken = require('../models/OAuthToken');
const CompanyLocation = require('../models/CompanyLocation');

/**
 * GoHighLevel API service for HelmDesk.
 *
 * Handles the full OAuth token lifecycle (location + company tokens, refresh, mint-from-company)
 * and the Conversations / Contacts endpoints HelmDesk needs to RECEIVE inbound (via webhook,
 * elsewhere) and SEND replies back out on the customer's original channel.
 *
 * Token machinery is battle-tested (ported from the Vaultsuite marketplace apps): it survives
 * 401 races between concurrent requests and backs off on 429 rate limits.
 */
class GHLService {
  constructor() {
    this.baseURL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
    this.oauthURL = process.env.GHL_OAUTH_URL || 'https://services.leadconnectorhq.com/oauth';
    this.version = '2021-07-28';
  }

  /** Exchange an OAuth authorization code for tokens. */
  async getAccessToken(code) {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GHL_CLIENT_ID);
    params.append('client_secret', process.env.GHL_CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);

    const { data } = await axios.post(`${this.oauthURL}/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    logger.info('Token exchange successful', { locationId: data.locationId, companyId: data.companyId });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      locationId: data.locationId,
      companyId: data.companyId,
      userId: data.userId || null
    };
  }

  /** Refresh an access token using a refresh token. */
  async refreshAccessToken(refreshToken) {
    const params = new URLSearchParams();
    params.append('client_id', process.env.GHL_CLIENT_ID);
    params.append('client_secret', process.env.GHL_CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const { data } = await axios.post(`${this.oauthURL}/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  /** Fetch a single GHL user (the installer / an agent) by id. Never throws — returns null on error. */
  async getUserWithToken(userId, accessToken) {
    if (!userId || !accessToken) return null;
    try {
      const { data } = await axios.get(`${this.baseURL}/users/${userId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Version: this.version }
      });
      const u = data?.user || data || {};
      return {
        id: u.id || userId,
        email: u.email || null,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || null
      };
    } catch (err) {
      logger.warn('getUserWithToken failed (non-blocking):', { userId, error: err.response?.data || err.message });
      return null;
    }
  }

  /**
   * Mint a location-scoped token from a company token. Required for agency-level installs,
   * where only a company token exists until a location is first accessed.
   */
  async getLocationTokenFromCompany(companyId, locationId, retryCount = 0) {
    let companyToken = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
    if (!companyToken) throw new Error('No company token found');

    if (companyToken.needsRefresh()) {
      try {
        const refreshed = await this.refreshAccessToken(companyToken.refreshToken);
        companyToken.accessToken = refreshed.accessToken;
        companyToken.refreshToken = refreshed.refreshToken;
        companyToken.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
        await companyToken.save();
      } catch (refreshErr) {
        // Another process may have already rotated the refresh token.
        if (refreshErr.response?.data?.error === 'invalid_grant') {
          const latest = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
          if (latest && latest.accessToken !== companyToken.accessToken) {
            companyToken = latest;
          } else {
            throw new Error('Company token expired. Please reconnect HelmDesk.');
          }
        } else {
          throw refreshErr;
        }
      }
    }

    try {
      const { data } = await axios.post(
        `${this.oauthURL}/locationToken`,
        { companyId, locationId },
        { headers: { Authorization: `Bearer ${companyToken.accessToken}`, 'Content-Type': 'application/json', Version: this.version } }
      );
      return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
    } catch (error) {
      if (error.response?.status === 401 && retryCount === 0) {
        // Force a refresh and retry once.
        const tok = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
        if (tok?.refreshToken) {
          try {
            const refreshed = await this.refreshAccessToken(tok.refreshToken);
            tok.accessToken = refreshed.accessToken;
            tok.refreshToken = refreshed.refreshToken;
            tok.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
            await tok.save();
          } catch (e) {
            if (e.response?.data?.error !== 'invalid_grant') throw e;
          }
          return this.getLocationTokenFromCompany(companyId, locationId, retryCount + 1);
        }
      }
      logger.error('Failed to generate location token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Resolve a valid access token for a location, refreshing or minting-from-company as needed.
   * This is the single entry point every API call funnels through.
   */
  async getValidToken(locationId) {
    let tokenDoc = await OAuthToken.findOne({ locationId, tokenType: 'location', isActive: true });

    if (!tokenDoc) {
      const companyLoc = await CompanyLocation.findCompanyByLocation(locationId);
      if (!companyLoc) {
        const err = new Error('Location not connected. Please reconnect HelmDesk.');
        err.status = 404;
        err.isClientError = true;
        throw err;
      }
      const companyToken = await OAuthToken.findOne({ companyId: companyLoc.companyId, tokenType: 'company', isActive: true });
      if (!companyToken) {
        const err = new Error('Company token expired. Please reconnect HelmDesk.');
        err.status = 401;
        err.isClientError = true;
        throw err;
      }
      const minted = await this.getLocationTokenFromCompany(companyLoc.companyId, locationId);
      tokenDoc = await OAuthToken.findOneAndUpdate(
        { locationId, tokenType: 'location' },
        {
          locationId,
          companyId: companyLoc.companyId,
          tokenType: 'location',
          accessToken: minted.accessToken,
          refreshToken: minted.refreshToken,
          expiresAt: new Date(Date.now() + minted.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );
    }

    if (tokenDoc.needsRefresh()) {
      try {
        const fresh = await this.refreshAccessToken(tokenDoc.refreshToken);
        tokenDoc.accessToken = fresh.accessToken;
        tokenDoc.refreshToken = fresh.refreshToken;
        tokenDoc.expiresAt = new Date(Date.now() + fresh.expiresIn * 1000);
        await tokenDoc.save();
      } catch (refreshErr) {
        if (refreshErr.response?.data?.error === 'invalid_grant') {
          const latest = await OAuthToken.findActiveToken(locationId);
          if (latest && latest.accessToken !== tokenDoc.accessToken) return latest.accessToken;
        }
        throw refreshErr;
      }
    }

    return tokenDoc.accessToken;
  }

  /**
   * Authenticated GHL API request with auto-refresh on 401 and exponential backoff on 429.
   */
  async apiRequest(method, endpoint, locationId, data = null, params = null, retryCount = 0) {
    try {
      const accessToken = await this.getValidToken(locationId);
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Version: this.version }
      };
      if (data) config.data = data;
      if (params) config.params = params;
      const response = await axios(config);
      return response.data;
    } catch (error) {
      // 401 → refresh once and retry (re-fetch latest token to dodge concurrent-refresh races).
      if (error.response?.status === 401 && retryCount === 0) {
        const tokenDoc = await OAuthToken.findActiveToken(locationId);
        if (!tokenDoc?.refreshToken) throw new Error('Authentication failed. Please reconnect HelmDesk.');

        const expiresIn = tokenDoc.expiresAt - Date.now();
        if (expiresIn > 23 * 60 * 60 * 1000) {
          return this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);
        }
        try {
          const fresh = await this.refreshAccessToken(tokenDoc.refreshToken);
          tokenDoc.accessToken = fresh.accessToken;
          tokenDoc.refreshToken = fresh.refreshToken;
          tokenDoc.expiresAt = new Date(Date.now() + fresh.expiresIn * 1000);
          await tokenDoc.save();
        } catch (refreshErr) {
          if (refreshErr.response?.data?.error === 'invalid_grant') {
            const latest = await OAuthToken.findActiveToken(locationId);
            if (!latest || latest.accessToken === tokenDoc.accessToken) throw refreshErr;
          } else {
            throw refreshErr;
          }
        }
        return this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);
      }

      // 429 → exponential backoff, up to 3 retries.
      if (error.response?.status === 429 && retryCount < 3) {
        const retryAfter = error.response?.headers?.['retry-after'];
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoffMs;
        logger.warn(`Rate limited (429), retrying in ${waitMs}ms`, { endpoint });
        await new Promise((r) => setTimeout(r, waitMs));
        return this.apiRequest(method, endpoint, locationId, data, params, retryCount + 1);
      }

      logger.error(`API request failed: ${method} ${endpoint}`, {
        status: error.response?.status,
        message: error.response?.data?.message || error.message
      });
      throw error;
    }
  }

  // ── Locations ──────────────────────────────────────────────────────────────
  async getLocationDetails(locationId) {
    try {
      const response = await this.apiRequest('GET', `/locations/${locationId}`, locationId);
      const loc = response.location || response;
      return {
        locationName: loc.name || null,
        locationEmail: loc.email || null,
        locationPhone: loc.phone || null,
        locationTimezone: loc.timezone || null
      };
    } catch (error) {
      logger.warn('getLocationDetails failed (non-critical):', error.message);
      return { locationName: null, locationEmail: null, locationPhone: null, locationTimezone: null };
    }
  }

  async getCompanyLocations(companyId, companyAccessToken) {
    try {
      const { data } = await axios.get(`${this.baseURL}/locations/search`, {
        headers: { Authorization: `Bearer ${companyAccessToken}`, 'Content-Type': 'application/json', Version: this.version },
        params: { companyId, limit: 100 }
      });
      return (data.locations || []).map((loc) => ({
        locationId: loc.id,
        locationName: loc.name,
        locationEmail: loc.email || null
      }));
    } catch (error) {
      logger.error('getCompanyLocations failed:', { message: error.message, status: error.response?.status });
      return [];
    }
  }

  // ── Contacts ─────────────────────────────────────────────────────────────────
  /** Fetch a single contact by id. Used to populate ticket contact name/email/phone. */
  async getContact(locationId, contactId) {
    try {
      const response = await this.apiRequest('GET', `/contacts/${contactId}`, locationId);
      const c = response.contact || response;
      return {
        id: c.id || contactId,
        name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Unknown',
        email: c.email || null,
        phone: c.phone || null,
        companyName: c.companyName || null
      };
    } catch (error) {
      logger.warn('getContact failed (non-blocking):', { contactId, error: error.message });
      return { id: contactId, name: 'Unknown contact', email: null, phone: null, companyName: null };
    }
  }

  /** Upsert a contact (create or merge by email/phone). Used by the public portal intake. */
  async upsertContact(locationId, contactData) {
    const body = { ...contactData, locationId };
    const response = await this.apiRequest('POST', '/contacts/upsert', locationId, body);
    return response.contact || response;
  }

  // ── Conversations / Messages ──────────────────────────────────────────────────
  /** Fetch a conversation by id (to know its channel/contact when we only have conversationId). */
  async getConversation(locationId, conversationId) {
    const response = await this.apiRequest('GET', `/conversations/${conversationId}`, locationId);
    return response.conversation || response;
  }

  /** Create a conversation for a contact (used when the portal creates a ticket for a fresh contact). */
  async createConversation(locationId, conversationData) {
    const response = await this.apiRequest('POST', '/conversations/', locationId, conversationData);
    return response.conversation || response;
  }

  /**
   * Send an outbound message on the customer's channel.
   * POST /conversations/messages
   * `data` shape: { type: 'SMS'|'Email'|'WhatsApp'|'IG'|'FB'|'Live_Chat'|'Custom', contactId, message, html?, subject?, ... }
   * This is how an agent's reply leaves HelmDesk and reaches the customer through GHL.
   */
  async sendMessage(locationId, data) {
    return this.apiRequest('POST', '/conversations/messages', locationId, data);
  }

  /**
   * Record an inbound message into GHL's native conversation (optional mirror).
   * POST /conversations/messages/inbound — keeps the GHL Conversations view in sync with
   * activity that originated in HelmDesk (e.g. a portal-submitted ticket).
   */
  async addInboundMessage(locationId, data) {
    return this.apiRequest('POST', '/conversations/messages/inbound', locationId, data);
  }

  // ── Users (agents) ────────────────────────────────────────────────────────────
  /** Search users for a location/company — used to populate the agent roster for assignment. */
  async searchUsers(locationId, { companyId } = {}) {
    try {
      const response = await this.apiRequest('GET', '/users/search', locationId, null, {
        companyId,
        locationId,
        query: ''
      });
      return response.users || [];
    } catch (error) {
      logger.warn('searchUsers failed (non-blocking):', { locationId, error: error.message });
      return [];
    }
  }
}

module.exports = new GHLService();
