/**
 * Survey Slide Field Configuration
 * ─────────────────────────────────
 * Each key is a canonical field name used throughout the system.
 * The value is the CSS selector used inside the GHL survey iframe/page.
 *
 * To add / remove / move a field:
 *  1. Edit this file only.
 *  2. The client script (public/survey-tracker.js) reads window.__SURVEY_SLIDES__
 *     which is generated from this config at runtime (served by GET /tracker-config).
 *  3. No other file needs changing.
 *
 * NOTE: slide9 appears twice in the original spec — here we keep both as
 *       slide9 (dependents 3) and slide9b (dependents 4) to avoid key collision.
 */

const SLIDES = {
  slide1: {
    areYouOnMedicaidOrMedicare: '[data-q="are_you_on_medicaid_or_medicare"]',
    firstName:                  '[data-q="first_name"]',
    lastName:                   '[data-q="last_name"]',
    email:                      '[data-q="email"]',
    phone:                      '[data-q="phone"]',
    internalAgents:             '[data-q="internal_agents"]',
    assignedLicensedAgentName:  '[data-q="assigned_licensed_agent_name"]',
  },

  slide2: {
    address:               '[data-q="address"]',
    city:                  '[data-q="city"]',
    state:                 '[data-q="state"]',
    zipCode:               '[data-q="postal_code"]',
    county:                '[data-q="county"]',
    preferredCounty:       '[data-q="preferred_county"]',
    trustedFormPingUrl:    '[data-q="trusted_form_ping_url"]',
    ipAddress:             '[data-q="ip_address"]',
    trustedFormCertUrl:    '[data-q="trusted_form_cert_url"]',
  },

  slide3: {
    dateOfBirth:                        '[data-q="date_of_birth"]',
    socialSecurity:                     '[data-q="social_security"]',
    socialSecurityVerificationStatus:   '[data-q="social_security_number_verification_status"]',
    socialSecurityVerificationId:       '[data-q="social_security_number_verification_id"]',
    gender:                             '#ho3Gus1PDnWjtNdamkQ8',
    maritalStatus:                      '#ZQkJKdWpOFiyY28C5J9l',
  },

  slide4: {
    spouseFirstName:   '#QuMjr1UdNJ0fFojWiHKO',
    spouseLastName:    '#QCy6kFdAhDS73VE7J2sK',
    spouseGender:      '#EtnA2kebwGAjFmBw2CRk',
    spouseDateOfBirth: '#3uGsljJnkLjxJR5WYwIE',
    enrollSpouse:      '#Ks8nbYz7euohlQMYnigw',
  },

  slide5: {
    spouseSSN: '[data-q="spouse_ssn"]',
  },

  slide6: {
    hasTaxDependents: '#9Sp4TrDAQUz3Ue4khdPz',
  },

  slide7: {
    dependent1FirstName: '[data-q="dependent_1_firstname"]',
    dependent1LastName:  '[data-q="dependent_1_lastname"]',
    dependent1Gender:    '#j1FeFQiwj9xvdJRfuxow',
    dependent1DOB:       '[data-q="dependent_1_date_of_birth_mm-dd-yyyy"]',
    enrollDependent1:    '#9HJs8AF5Ic5on4MDrn49',
    dependent1SSN:       '[data-q="dependent_1_social_security_number"]',
    hasDependent2:       '#PKFqYnajJdHlcB24HHnu',
  },

  slide8: {
    dependent2FirstName: '[data-q="dependent_2_firstname"]',
    dependent2LastName:  '[data-q="dependent_2_lastname"]',
    dependent2Gender:    '#6z8kSOJQOGjoO7uUBAfE',
    dependent2DOB:       '[data-q="dependent_2_date_of_birth_mm-dd-yyyy"]',
    enrollDependent2:    '#8Y6HjD8KB2dY3VJw1kfM',
    dependent2SSN:       '[data-q="dependent_2_social_security_number"]',
    hasDependent3:       '#mlTR3xUPTAzpEIUDLCNb',
  },

  // Dependent 3
  slide9: {
    dependent3FirstName: '[data-q="dependent_3_firstname"]',
    dependent3LastName:  '[data-q="dependent_3_lastname"]',
    dependent3Gender:    '#qpPnTo7nf1GIuzS8WzoC',
    dependent3DOB:       '[data-q="dependent_3_date_of_birth_mm-dd-yyyy"]',
    enrollDependent3:    '#wZcqlTDIdocDmvu6fHHC',
    dependent3SSN:       '[data-q="dependent_3_social_security_number"]',
    hasDependent4:       '#i4YsyvVMirkwkcI3CVYM',
  },

  // Dependent 4 (originally a second slide9 in the spec — renamed slide9b)
  slide9b: {
    dependent4FirstName: '[data-q="dependent_4_firstname"]',
    dependent4LastName:  '[data-q="dependent_4_lastname"]',
    dependent4Gender:    '#IsmDptGMFi2UltW475XW',
    dependent4DOB:       '[data-q="dependent_4_date_of_birth_mm-dd-yyyy"]',
    enrollDependent4:    '#LP5iYtOQCp6xJwzXh2Qv',
    dependent4SSN:       '[data-q="dependent_4_social_security_number"]',
    hasDependent5:       '#BJfc56jvST6pwNJapj79',
  },

  slide10: {
    dependent5FirstName: '[data-q="dependent_5_firstname"]',
    dependent5LastName:  '[data-q="dependent_5_lastname"]',
    dependent5Gender:    '#VxhnyXrkXLKx3I7xc2j0',
    dependent5DOB:       '[data-q="dependent_5_date_of_birth_mm-dd-yyyy"]',
    enrollDependent5:    '#eCzF4YRIBxvuJxyZCqBO',
    dependent5SSN:       '[data-q="dependent_5_social_security_number"]',
    hasDependent6:       '#2FOtSfbEo2CbB3XBg0Ii',
    listTheRestOfDependentInfo: '[data-q="list_the_rest_of_your_dependent_information_here"]',
  },

  slide11: {
    mostRecentEmployerName:           '[data-q="most_recent_employer_name_or_company_name_if_self_employed"]',
    projectedAnnualIncome:            '[data-q="single_projected_annual_income_for_this_year_based_on_household_size"]',
    selectedProjectedAnnualIncome:    '[data-q="selected_projected_annual_income_for_this_year_based_on_household_size"]',
    employmentStatus:                 '#BvtGSZTh8bQlrLKO5K6m',
  },

  slide12: {
    enrollmentAgreement: '[data-q="i_agree_to_be_enrolled_in_the_aca_plan_i_have_chosen_and_authorize_the_licensed_agent_to_process_my_enrollment_request."]',
  },
};

/**
 * The field on slide1 that holds the lead's email address.
 * Session is only initiated AFTER this field is populated.
 */
const EMAIL_FIELD = { slide: 'slide1', field: 'email', selector: SLIDES.slide1.email };

/**
 * The field on slide1 that holds the lead's phone number.
 * Included in the session-init call to the other server.
 */
const PHONE_FIELD = { slide: 'slide1', field: 'phone', selector: SLIDES.slide1.phone };

/**
 * Last slide key — reaching this marks the session as completed.
 * Also: saving a plan_id via POST /api/session/:id/plan marks it complete.
 */
const LAST_SLIDE = 'slide12';

module.exports = { SLIDES, EMAIL_FIELD, PHONE_FIELD, LAST_SLIDE };
