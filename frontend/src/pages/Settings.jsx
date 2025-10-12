import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../providers/AuthProvider.jsx'
import { api } from '../lib/api'
import { getAccessToken, setUserProfile as persistUserProfile } from '../lib/auth'
import { resolveAssetUrl } from '../lib/urls'
import { APP_NAME, ORGANIZATION_TYPES, PASSWORD_REQUIREMENTS, STRONG_PASSWORD_PATTERN } from '../lib/appInfo.js'
import TablePagination from '../components/TablePagination.jsx'
import DeveloperTerminal from '../components/DeveloperTerminal.jsx'

const uiVariants = [
  {
    id: 'pro',
    name: 'Professional',
    description: 'Balanced layout with charts, tables and actionable KPIs.'
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Graph-focused workspace for performance tracking and forecasting.'
  },
  {
    id: 'tabular',
    name: 'Tabular',
    description: 'High-density tables optimised for bulk operations and data entry.'
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Distraction-free controls with simplified navigation for rapid work.'
  },
  {
    id: 'visual',
    name: 'Visual',
    description: 'Large charts and tiles for status-at-a-glance monitoring.'
  }
]

const SAMPLE_SEED_TEMPLATE = `{
  "products": [
    {
      "sku": "TOOL-SET-001",
      "name": "Technician starter kit",
      "reorder_point": 5,
      "lead_time_days": 7,
      "unit_price": 249.5
    },
    {
      "sku": "LAPTOP-15",
      "name": "Service laptop 15\"",
      "reorder_point": 2,
      "lead_time_days": 5,
      "unit_price": 1399,
      "track_serial": true
    }
  ],
  "locations": [
    {
      "site": "Sydney HQ",
      "room": "Service Bay",
      "notes": "Primary repair hub"
    },
    {
      "site": "Melbourne Depot",
      "room": "Logistics",
      "notes": "Forward staging area"
    }
  ],
  "bins": [
    {
      "code": "SYD-A1",
      "location_site": "Sydney HQ"
    },
    {
      "code": "SYD-B2",
      "location_site": "Sydney HQ"
    },
    {
      "code": "MEL-A1",
      "location_site": "Melbourne Depot"
    }
  ],
  "stock": [
    {
      "sku": "TOOL-SET-001",
      "bin": "SYD-A1",
      "on_hand": 12
    },
    {
      "sku": "TOOL-SET-001",
      "bin": "MEL-A1",
      "on_hand": 4,
      "reserved": 1
    },
    {
      "sku": "LAPTOP-15",
      "bin": "SYD-B2",
      "on_hand": 6,
      "reserved": 2
    }
  ]
}`

export default function Settings() {
  const { user, setUser, organization } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const isDeveloper = user?.role === 'developer'
  const activeVariant = uiVariants.find((variant) => variant.id === (user?.ui_variant || 'pro')) || uiVariants[0]

  const navigationItems = useMemo(() => {
    const items = []

    if (!isDeveloper) {
      items.push({ id: 'profile', label: 'Profile & preferences' })
    }

    if (isDeveloper) {
      items.push(
        { id: 'readiness', label: 'Security & readiness' },
        { id: 'organization', label: 'Organization profile' },
        { id: 'operations', label: 'Operations & alerts' }
      )
    }

    if (isAdmin && !isDeveloper) {
      items.push(
        { id: 'team', label: 'User management' },
        { id: 'records', label: 'Audit & backups' }
      )
    }

    if (isDeveloper) {
      items.push({ id: 'developer', label: 'Developer tools' })
    }

    return items
  }, [isAdmin, isDeveloper])

  const [activeSection, setActiveSection] = useState(() => navigationItems[0]?.id || 'profile')

  useEffect(() => {
    if (!navigationItems.some((item) => item.id === activeSection)) {
      setActiveSection(navigationItems[0]?.id || 'profile')
    }
  }, [activeSection, navigationItems])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!location.hash) return
    const target = location.hash.replace('#', '')
    if (!target) return
    const exists = navigationItems.some((item) => item.id === target)
    if (!exists) return
    setActiveSection(target)
  }, [location.hash, navigationItems])

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await api.get('/settings')
      return data
    },
    enabled: isDeveloper
  })

  const { data: readinessReport } = useQuery({
    queryKey: ['readiness-report'],
    queryFn: async () => {
      const { data } = await api.get('/readiness')
      return data
    },
    enabled: isDeveloper
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/users')
      return data
    },
    enabled: isAdmin
  })

  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [activityPage, setActivityPage] = useState(1)
  const [backupPage, setBackupPage] = useState(1)
  const [seedPayload, setSeedPayload] = useState(null)
  const [developerBanner, setDeveloperBanner] = useState(null)
  const [seedResult, setSeedResult] = useState(null)
  const [terminalSession, setTerminalSession] = useState(null)
  const [seedFileName, setSeedFileName] = useState('')
  const seedInputRef = useRef(null)

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users
    const term = userSearch.toLowerCase()
    return users.filter((account) => {
      const name = (account.full_name || '').toLowerCase()
      const email = (account.email || '').toLowerCase()
      const role = (account.role || '').toLowerCase()
      return name.includes(term) || email.includes(term) || role.includes(term)
    })
  }, [users, userSearch])

  const USERS_PAGE_SIZE = 10
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE))
  const visibleUsers = useMemo(() => {
    const start = (userPage - 1) * USERS_PAGE_SIZE
    return filteredUsers.slice(start, start + USERS_PAGE_SIZE)
  }, [filteredUsers, userPage])

  useEffect(() => {
    setUserPage(1)
  }, [userSearch])

  useEffect(() => {
    if (userPage > totalUserPages) {
      setUserPage(totalUserPages)
    }
  }, [userPage, totalUserPages])

  const { data: backups = [] } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => {
      const { data } = await api.get('/backups')
      return data?.backups || []
    },
    enabled: isAdmin
  })

  const { data: activities = [] } = useQuery({
    queryKey: ['user-activities'],
    queryFn: async () => {
      const { data } = await api.get('/users/activities')
      return data
    },
    enabled: isAdmin
  })

  const ACTIVITIES_PAGE_SIZE = 10
  const totalActivityPages = Math.max(1, Math.ceil(activities.length / ACTIVITIES_PAGE_SIZE))
  const visibleActivities = useMemo(() => {
    const start = (activityPage - 1) * ACTIVITIES_PAGE_SIZE
    return activities.slice(start, start + ACTIVITIES_PAGE_SIZE)
  }, [activities, activityPage])

  const BACKUPS_PAGE_SIZE = 10
  const totalBackupPages = Math.max(1, Math.ceil(backups.length / BACKUPS_PAGE_SIZE))
  const visibleBackups = useMemo(() => {
    const start = (backupPage - 1) * BACKUPS_PAGE_SIZE
    return backups.slice(start, start + BACKUPS_PAGE_SIZE)
  }, [backups, backupPage])

  const readinessChecks = useMemo(() => readinessReport?.checks || [], [readinessReport?.checks])
  const readinessGeneratedAt = readinessReport?.generated_at || null
  const readinessSummary = readinessReport?.summary || null

  const seedPreview = useMemo(() => {
    if (!seedPayload) return null
    const count = (collection) => (Array.isArray(collection) ? collection.length : 0)
    return {
      products: count(seedPayload.products),
      locations: count(seedPayload.locations),
      bins: count(seedPayload.bins),
      stock: count(seedPayload.stock)
    }
  }, [seedPayload])

  useEffect(() => {
    if (activityPage > totalActivityPages) {
      setActivityPage(totalActivityPages)
    }
  }, [activityPage, totalActivityPages])

  useEffect(() => {
    if (backupPage > totalBackupPages) {
      setBackupPage(totalBackupPages)
    }
  }, [backupPage, totalBackupPages])

  const { data: organizationDetails } = useQuery({
    queryKey: ['organization'],
    queryFn: async () => {
      const { data } = await api.get('/organization')
      return data
    },
    enabled: isAdmin || isDeveloper
  })

  const [formState, setFormState] = useState({
    low_stock_alerts_enabled: true,
    default_sla_hours: 24,
    notification_emails: '',
    backup_enabled: false,
    backup_schedule: '0 3 * * *',
    backup_retain_days: 14,
    daily_digest_enabled: false,
    daily_digest_time: '18:00',
    auto_product_sku: false,
    auto_customer_id: false,
    auto_warehouse_id: false,
    barcode_scanning_enabled: true,
    work_orders_enabled: true,
    sales_module_enabled: true,
    operations_module_enabled: true
  })
  const [banner, setBanner] = useState(null)
  const [userBanner, setUserBanner] = useState(null)
  const [preferencesBanner, setPreferencesBanner] = useState(null)
  const [developerKey, setDeveloperKey] = useState('')
  const [developerOtp, setDeveloperOtp] = useState('')
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'user',
    must_change_password: true,
    ui_variant: 'pro'
  })
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'user',
    must_change_password: false,
    ui_variant: 'pro'
  })
  const [selectedVariant, setSelectedVariant] = useState(user?.ui_variant || 'pro')
  const [transitionLoading, setTransitionLoading] = useState(user?.transition_loading_enabled !== false)
  const [orgBanner, setOrgBanner] = useState(null)
  const [orgForm, setOrgForm] = useState({
    name: organization?.name || user?.organization?.name || '',
    contact_email: organization?.contact_email || '',
    legal_name: organization?.legal_name || '',
    type: organization?.type || user?.organization?.type || '',
    timezone: organization?.timezone || '',
    abn: organization?.abn || '',
    tax_id: organization?.tax_id || '',
    address: organization?.address || '',
    phone: organization?.phone || '',
    website: organization?.website || '',
    logo_url: organization?.logo_url || '',
    invoice_prefix: organization?.invoice_prefix || '',
    default_payment_terms: organization?.default_payment_terms || '',
    invoice_notes: organization?.invoice_notes || '',
    currency: organization?.currency || 'AUD',
    invoicing_enabled: organization?.invoicing_enabled !== false,
    banner_images: Array.isArray(organization?.banner_images)
      ? organization.banner_images.join('\n')
      : ''
  })
  const [logoPreview, setLogoPreview] = useState(() => {
    const initialLogo = organization?.logo_url || user?.organization?.logo_url || ''
    const version = organization?.logo_updated_at || user?.organization?.logo_updated_at || null
    const resolved = resolveAssetUrl(initialLogo)
    if (!resolved) return ''
    return version ? `${resolved}${resolved.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : resolved
  })
  const selectedOrgType = useMemo(
    () => ORGANIZATION_TYPES.find((item) => item.id === orgForm.type) || null,
    [orgForm.type]
  )
  const buildLogoAssetUrl = useCallback((url, version) => {
    const resolved = resolveAssetUrl(url || '')
    if (!resolved) return ''
    return version
      ? `${resolved}${resolved.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`
      : resolved
  }, [])

  const bannerList = useMemo(() => (
    orgForm.banner_images
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)
  ), [orgForm.banner_images])

  const bannerPreview = useMemo(
    () => bannerList.map((value) => resolveAssetUrl(value)),
    [bannerList]
  )

  useEffect(() => {
    if (settingsData) {
      setFormState({
        low_stock_alerts_enabled: settingsData.low_stock_alerts_enabled !== false,
        default_sla_hours: settingsData.default_sla_hours ?? 24,
        notification_emails: Array.isArray(settingsData.notification_emails)
          ? settingsData.notification_emails.join(', ')
          : '',
        backup_enabled: settingsData.backup_enabled !== false,
        backup_schedule: settingsData.backup_schedule || '0 3 * * *',
        backup_retain_days: settingsData.backup_retain_days ?? 14,
        daily_digest_enabled: settingsData.daily_digest_enabled === true,
        daily_digest_time: settingsData.daily_digest_time || '18:00',
        auto_product_sku: settingsData.auto_product_sku === true,
        auto_customer_id: settingsData.auto_customer_id === true,
        auto_warehouse_id: settingsData.auto_warehouse_id === true,
        barcode_scanning_enabled: settingsData.barcode_scanning_enabled !== false,
        work_orders_enabled: settingsData.work_orders_enabled !== false,
        sales_module_enabled: settingsData.sales_module_enabled !== false,
        operations_module_enabled: settingsData.operations_module_enabled !== false
      })
    }
  }, [settingsData])

  useEffect(() => {
    setSelectedVariant(user?.ui_variant || 'pro')
  }, [user?.ui_variant])

  useEffect(() => {
    if (organizationDetails) {
      setOrgForm({
        name: organizationDetails.name || '',
        legal_name: organizationDetails.legal_name || '',
        contact_email: organizationDetails.contact_email || '',
        type: organizationDetails.type || '',
        timezone: organizationDetails.timezone || '',
        abn: organizationDetails.abn || '',
        tax_id: organizationDetails.tax_id || '',
        address: organizationDetails.address || '',
        phone: organizationDetails.phone || '',
        website: organizationDetails.website || '',
        logo_url: organizationDetails.logo_url || '',
        invoice_prefix: organizationDetails.invoice_prefix || '',
        default_payment_terms: organizationDetails.default_payment_terms || '',
        invoice_notes: organizationDetails.invoice_notes || '',
        currency: organizationDetails.currency || 'AUD',
        invoicing_enabled: organizationDetails.invoicing_enabled !== false,
        banner_images: Array.isArray(organizationDetails.banner_images)
          ? organizationDetails.banner_images.join('\n')
          : ''
      })
      setLogoPreview(buildLogoAssetUrl(organizationDetails.logo_url || '', organizationDetails.logo_updated_at))
      updateCachedOrganization(organizationDetails)
    }
  }, [organizationDetails])

  useEffect(() => {
    setLogoPreview(resolveAssetUrl(orgForm.logo_url || ''))
  }, [orgForm.logo_url])

  useEffect(() => {
    setTransitionLoading(user?.transition_loading_enabled !== false)
  }, [user?.transition_loading_enabled])

  const settingsMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.put('/settings', payload)
      return response
    },
    onSuccess: (response, variables) => {
      if (response?.data?.offline) {
        setBanner('Offline update queued. Settings will sync when back online.')
      } else {
        setBanner('Settings saved successfully.')
      }
      const featureUpdates = {}
      ['barcode_scanning_enabled', 'work_orders_enabled', 'sales_module_enabled', 'operations_module_enabled'].forEach((key) => {
        if (typeof variables?.[key] === 'boolean') {
          featureUpdates[key] = variables[key]
        }
      })
      if (Object.keys(featureUpdates).length > 0) {
        setUser((prev) => {
          if (!prev?.organization) return prev
          const updatedOrg = {
            ...prev.organization,
            features: {
              ...(prev.organization.features || {}),
              ...featureUpdates
            }
          }
          const updatedUser = { ...prev, organization: updatedOrg }
          persistUserProfile(updatedUser)
          return updatedUser
        })
      }
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    }
  })

  const preferencesMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.put('/users/me/preferences', payload)
      return data
    },
    onSuccess: (updated) => {
      const transitionEnabled = updated.transition_loading_enabled ?? transitionLoading
      const merged = {
        ...user,
        ...updated,
        name: updated.full_name || updated.name || user?.name,
        ui_variant: updated.ui_variant || selectedVariant,
        transition_loading_enabled: transitionEnabled
      }
      setUser(merged)
      persistUserProfile(merged)
      setTransitionLoading(transitionEnabled)
      setPreferencesBanner({ type: 'success', message: 'Interface preferences updated.' })
    },
    onError: (error) => {
      setPreferencesBanner({ type: 'error', message: error.response?.data?.error || 'Unable to save preferences.' })
    }
  })

  const createUserMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/users', payload)
      return data
    },
    onSuccess: () => {
      setUserBanner({ type: 'success', message: 'User account created successfully.' })
      setUserForm({
        full_name: '',
        email: '',
        password: '',
        role: 'user',
        must_change_password: true,
        ui_variant: 'pro'
      })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      setUserBanner({ type: 'error', message: error.response?.data?.error || 'Unable to create user.' })
    }
  })

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.put(`/users/${id}`, payload)
      return data
    },
    onSuccess: (updatedUser) => {
      setUserBanner({ type: 'success', message: 'User details updated successfully.' })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditingUser(null)
      setEditForm({
        full_name: '',
        email: '',
        password: '',
        role: 'user',
        must_change_password: false,
        ui_variant: 'pro'
      })
      if (updatedUser?.id === user?.id) {
        const merged = {
          ...user,
          ...updatedUser,
          name: updatedUser.full_name
        }
        setUser(merged)
        persistUserProfile(merged)
      }
    },
    onError: (error) => {
      setUserBanner({ type: 'error', message: error.response?.data?.error || 'Unable to update user.' })
    }
  })

  const deleteUserMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/users/${id}`)
    },
    onSuccess: (_data, id) => {
      setUserBanner({ type: 'success', message: 'User removed successfully.' })
      if (editingUser?.id === id) {
        setEditingUser(null)
        setEditForm({
          full_name: '',
          email: '',
          password: '',
          role: 'user',
          must_change_password: false
        })
      }
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => {
      setUserBanner({ type: 'error', message: error.response?.data?.error || 'Unable to remove user.' })
    }
  })

  const developerHeaders = () => ({
    'x-developer-key': developerKey.trim(),
    'x-developer-otp': developerOtp.trim()
  })

  const developerSeedMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/developer/seed', payload, {
        headers: developerHeaders()
      })
      return data
    },
    onSuccess: (data) => {
      setDeveloperBanner({ type: 'success', message: 'Seed data applied successfully.' })
      setSeedResult(data || null)
      setSeedPayload(null)
      setSeedFileName('')
      if (seedInputRef.current) {
        seedInputRef.current.value = ''
      }
      queryClient.invalidateQueries({ queryKey: ['stock-dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['stock-overview'] })
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Unable to seed data.'
      setDeveloperBanner({ type: 'error', message })
    }
  })

  const launchTerminalMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/developer/sessions/terminal', {}, {
        headers: developerHeaders()
      })
      return data
    },
    onSuccess: (sessionData) => {
      setTerminalSession(sessionData)
      setDeveloperBanner({ type: 'info', message: 'Web terminal session initialised.' })
    },
    onError: (error) => {
      setTerminalSession(null)
      const message = error.response?.data?.error || 'Unable to start terminal session.'
      setDeveloperBanner({ type: 'error', message })
    }
  })

  const exportDatabaseMutation = useMutation({
    mutationFn: async () => {
      return api.get('/developer/export', {
        responseType: 'blob',
        headers: developerHeaders()
      })
    },
    onSuccess: (response) => {
      if (typeof window === 'undefined') return
      const disposition = response.headers?.['content-disposition'] || ''
      const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i)
      const fallbackName = 'stock-export.json'
      const fileName = fileNameMatch ? fileNameMatch[1] : fallbackName
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      setDeveloperBanner({ type: 'info', message: `Database export downloaded as ${fileName}.` })
    },
    onError: (error) => {
      setDeveloperBanner({ type: 'error', message: error.response?.data?.error || 'Unable to export database.' })
    }
  })

  const organizationMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.put('/organization', payload)
      return data
    },
    onSuccess: (data) => {
      setOrgBanner({ type: 'success', message: 'Organization profile updated.' })
      setOrgForm({
        name: data.name || '',
        legal_name: data.legal_name || '',
        contact_email: data.contact_email || '',
        type: data.type || '',
        timezone: data.timezone || '',
        abn: data.abn || '',
        tax_id: data.tax_id || '',
        address: data.address || '',
        phone: data.phone || '',
        website: data.website || '',
        logo_url: data.logo_url || '',
        invoice_prefix: data.invoice_prefix || '',
        default_payment_terms: data.default_payment_terms || '',
        invoice_notes: data.invoice_notes || '',
        currency: data.currency || 'AUD',
        invoicing_enabled: data.invoicing_enabled !== false,
        banner_images: Array.isArray(data.banner_images)
          ? data.banner_images.join('\n')
          : ''
      })
      queryClient.invalidateQueries({ queryKey: ['organization'] })
      setLogoPreview(buildLogoAssetUrl(data.logo_url || '', data.logo_updated_at))
      updateCachedOrganization(data)
    },
    onError: (error) => {
      setOrgBanner({ type: 'error', message: error.response?.data?.error || 'Unable to update organization.' })
    }
  })

  const updateCachedOrganization = (data) => {
    if (!user) return
    const logoUrl = data.logo_url || ''
    const logoVersion = data.logo_updated_at || user.organization?.logo_updated_at || null
    const logoAssetUrl = buildLogoAssetUrl(logoUrl, logoVersion)
    const existingBannerImages = Array.isArray(user.organization?.banner_images)
      ? user.organization.banner_images
      : []
    const normalizedBanners = Array.isArray(data.banner_images)
      ? data.banner_images
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      : existingBannerImages
    const bannerAssets = normalizedBanners.map((item) => resolveAssetUrl(item))

    const mergedOrg = {
      ...(user.organization || {}),
      id: data.id ?? user.organization?.id ?? null,
      name: data.name ?? user.organization?.name ?? '',
      slug: data.slug ?? user.organization?.slug ?? '',
      contact_email: data.contact_email ?? user.organization?.contact_email ?? '',
      timezone: data.timezone ?? user.organization?.timezone ?? '',
      legal_name: data.legal_name ?? user.organization?.legal_name ?? '',
      type: data.type ?? user.organization?.type ?? '',
      abn: data.abn ?? user.organization?.abn ?? '',
      tax_id: data.tax_id ?? user.organization?.tax_id ?? '',
      address: data.address ?? user.organization?.address ?? '',
      phone: data.phone ?? user.organization?.phone ?? '',
      website: data.website ?? user.organization?.website ?? '',
      logo_url: logoUrl,
      logo_asset_url: logoAssetUrl,
      logo_updated_at: logoVersion,
      invoice_prefix: data.invoice_prefix ?? user.organization?.invoice_prefix ?? '',
      default_payment_terms: data.default_payment_terms ?? user.organization?.default_payment_terms ?? '',
      invoice_notes: data.invoice_notes ?? user.organization?.invoice_notes ?? '',
      currency: data.currency ?? user.organization?.currency ?? 'AUD',
      invoicing_enabled: data.invoicing_enabled !== undefined
        ? data.invoicing_enabled
        : (user.organization?.invoicing_enabled !== false),
      banner_images: normalizedBanners,
      banner_asset_urls: bannerAssets,
      features: {
        ...(user.organization?.features || {}),
        ...(data.features || {})
      }
    }
    const mergedUser = {
      ...user,
      organization: mergedOrg
    }
    setUser(mergedUser)
    persistUserProfile(mergedUser)
  }

  const uploadLogoMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData()
      formData.append('logo', file)
      const { data } = await api.post('/organization/logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      return data
    },
    onSuccess: (data) => {
      const nextLogo = data.logo_url || ''
      setOrgForm((prev) => ({ ...prev, logo_url: nextLogo }))
      setLogoPreview(buildLogoAssetUrl(nextLogo, data.logo_updated_at))
      setOrgBanner({ type: 'info', message: 'Logo updated successfully.' })
      queryClient.invalidateQueries({ queryKey: ['organization'] })
      updateCachedOrganization(data)
    },
    onError: (error) => {
      setOrgBanner({ type: 'error', message: error.response?.data?.error || 'Unable to upload logo.' })
    }
  })

  const uploadBannerMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData()
      formData.append('banner', file)
      const { data } = await api.post('/organization/banner', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      return data
    },
    onSuccess: (data) => {
      const uploaded = data?.banner_url
      const bannerList = Array.isArray(data?.banner_images)
        ? data.banner_images
        : null

      if (bannerList) {
        setOrgForm((prev) => ({
          ...prev,
          banner_images: bannerList.join('\n')
        }))
        updateCachedOrganization({ ...(organization || {}), banner_images: bannerList })
      } else if (uploaded) {
        setOrgForm((prev) => {
          const values = prev.banner_images
            .split(/\n|,/)
            .map((value) => value.trim())
            .filter(Boolean)
          if (values.includes(uploaded)) {
            return prev
          }
          const next = [...values, uploaded]
          return { ...prev, banner_images: next.join('\n') }
        })
      }

      queryClient.invalidateQueries({ queryKey: ['organization'] })
      setOrgBanner({ type: 'info', message: 'Banner uploaded and published to the dashboard.' })
    },
    onError: (error) => {
      setOrgBanner({ type: 'error', message: error.response?.data?.error || 'Unable to upload banner image.' })
    }
  })

  const runBackupMutation = useMutation({
    mutationFn: async () => {
      await api.post('/backups/run')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setBanner('Backup started successfully. Refresh in a moment to see the new snapshot.')
    },
    onError: (error) => {
      setBanner(error.response?.data?.error || 'Unable to trigger backup right now.')
    }
  })

  const handleSavePreferences = (event) => {
    event.preventDefault()
    setPreferencesBanner(null)
    preferencesMutation.mutate({
      ui_variant: selectedVariant,
      transition_loading_enabled: transitionLoading
    })
  }

  const handleLogoUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setOrgBanner({ type: 'error', message: 'Please upload a PNG or JPG image.' })
      event.target.value = ''
      return
    }
    const input = event.target
    setOrgBanner(null)
    uploadLogoMutation.mutate(file, {
      onSettled: () => {
        input.value = ''
      }
    })
  }

  const handleBannerUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const input = event.target
    if (bannerList.length >= 10) {
      setOrgBanner({ type: 'error', message: 'You can store up to 10 banner images. Remove one before uploading another.' })
      input.value = ''
      return
    }
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setOrgBanner({ type: 'error', message: 'Please upload a PNG or JPG image.' })
      input.value = ''
      return
    }
    setOrgBanner(null)
    uploadBannerMutation.mutate(file, {
      onSettled: () => {
        input.value = ''
      }
    })
  }

  const toggleInvoicing = () => {
    setOrgForm((prev) => ({
      ...prev,
      invoicing_enabled: !prev.invoicing_enabled
    }))
  }

  const handleOrganizationSubmit = (event) => {
    event.preventDefault()
    setOrgBanner(null)
    const payload = {
      name: orgForm.name.trim(),
      contact_email: orgForm.contact_email.trim(),
      legal_name: orgForm.legal_name.trim(),
      type: orgForm.type || '',
      timezone: orgForm.timezone.trim(),
      abn: orgForm.abn.trim(),
      tax_id: orgForm.tax_id.trim(),
      address: orgForm.address.trim(),
      phone: orgForm.phone.trim(),
      website: orgForm.website.trim(),
      logo_url: orgForm.logo_url.trim(),
      invoice_prefix: orgForm.invoice_prefix.trim(),
      default_payment_terms: orgForm.default_payment_terms.trim(),
      invoice_notes: orgForm.invoice_notes.trim(),
      currency: orgForm.currency.trim(),
      invoicing_enabled: Boolean(orgForm.invoicing_enabled)
    }
    const bannerImages = bannerList
    payload.banner_images = bannerImages
    if (!payload.name) {
      setOrgBanner({ type: 'error', message: 'Organization name is required.' })
      return
    }
    if (!payload.contact_email) delete payload.contact_email
    if (!payload.legal_name) delete payload.legal_name
    if (!payload.timezone) delete payload.timezone
    if (!payload.abn) delete payload.abn
    if (!payload.tax_id) delete payload.tax_id
    if (!payload.address) delete payload.address
    if (!payload.phone) delete payload.phone
    if (!payload.website) delete payload.website
    if (!payload.logo_url) delete payload.logo_url
    if (!payload.invoice_prefix) delete payload.invoice_prefix
    if (!payload.default_payment_terms) delete payload.default_payment_terms
    if (!payload.invoice_notes) delete payload.invoice_notes
    if (!payload.currency) {
      delete payload.currency
    } else {
      payload.currency = payload.currency.toUpperCase()
    }
    organizationMutation.mutate(payload)
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const payload = {
      low_stock_alerts_enabled: formState.low_stock_alerts_enabled,
      default_sla_hours: Number(formState.default_sla_hours) || 0,
      notification_emails: formState.notification_emails
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean),
      backup_enabled: Boolean(formState.backup_enabled),
      backup_schedule: formState.backup_schedule.trim(),
      backup_retain_days: Number(formState.backup_retain_days) || 0,
      daily_digest_enabled: Boolean(formState.daily_digest_enabled),
      daily_digest_time: formState.daily_digest_time?.trim() || '18:00',
      auto_product_sku: Boolean(formState.auto_product_sku),
      auto_customer_id: Boolean(formState.auto_customer_id),
      auto_warehouse_id: Boolean(formState.auto_warehouse_id),
      barcode_scanning_enabled: Boolean(formState.barcode_scanning_enabled),
      work_orders_enabled: Boolean(formState.work_orders_enabled),
      sales_module_enabled: Boolean(formState.sales_module_enabled),
      operations_module_enabled: Boolean(formState.operations_module_enabled)
    }
    settingsMutation.mutate(payload)
  }

  const ensureDeveloperSecrets = () => {
    if (!developerKey.trim() || !developerOtp.trim()) {
      setDeveloperBanner({ type: 'error', message: 'Provide the developer key and one-time passcode.' })
      return false
    }
    return true
  }

  const handleSeedFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setDeveloperBanner(null)
    setSeedResult(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      setSeedPayload(parsed)
      setSeedFileName(file.name)
    } catch (error) {
      console.error('Unable to parse seed file', error)
      setSeedPayload(null)
      setSeedFileName('')
      setDeveloperBanner({ type: 'error', message: 'Seed file must be valid JSON.' })
      if (seedInputRef.current) {
        seedInputRef.current.value = ''
      }
    }
  }

  const handleSeedClear = () => {
    setSeedPayload(null)
    setSeedFileName('')
    setSeedResult(null)
    if (seedInputRef.current) {
      seedInputRef.current.value = ''
    }
  }

  const handleSeedDownload = async () => {
    setDeveloperBanner(null)
    setSeedResult(null)
    if (!ensureDeveloperSecrets()) return
    try {
      const response = await api.get('/developer/seed/sample', {
        responseType: 'blob',
        headers: developerHeaders()
      })
      if (typeof window === 'undefined') return
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'stock-seed-sample.json'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      setDeveloperBanner({ type: 'info', message: 'Sample JSON downloaded.' })
    } catch (error) {
      setDeveloperBanner({ type: 'error', message: error.response?.data?.error || 'Unable to download sample file.' })
    }
  }

  const handleSeedSubmit = (event) => {
    event.preventDefault()
    if (!seedPayload) {
      setDeveloperBanner({ type: 'error', message: 'Select a JSON file containing seed data first.' })
      return
    }
    if (!ensureDeveloperSecrets()) return
    setDeveloperBanner(null)
    setSeedResult(null)
    developerSeedMutation.mutate(seedPayload)
  }

  const handleLaunchTerminal = () => {
    setDeveloperBanner(null)
    if (!ensureDeveloperSecrets()) return
    setTerminalSession(null)
    launchTerminalMutation.mutate()
  }

  const handleExportDatabase = () => {
    setDeveloperBanner(null)
    if (!ensureDeveloperSecrets()) return
    exportDatabaseMutation.mutate()
  }

  const handleCloseTerminal = () => {
    setTerminalSession(null)
    setDeveloperBanner((prev) => (prev?.type === 'error' ? prev : { type: 'info', message: 'Terminal session closed.' }))
  }

  const handleCreateUser = (event) => {
    event.preventDefault()
    setUserBanner(null)
    const payload = {
      full_name: userForm.full_name.trim(),
      email: userForm.email.trim(),
      password: userForm.password,
      role: userForm.role,
      must_change_password: Boolean(userForm.must_change_password),
      ui_variant: userForm.ui_variant
    }
    if (!payload.full_name || !payload.email || !payload.password) {
      setUserBanner({ type: 'error', message: 'All fields are required to create a user.' })
      return
    }
    if (!STRONG_PASSWORD_PATTERN.test(payload.password)) {
      setUserBanner({ type: 'error', message: PASSWORD_REQUIREMENTS })
      return
    }
    createUserMutation.mutate(payload)
  }

  const handleStartEdit = (selected) => {
    setUserBanner(null)
    setEditingUser(selected)
    setEditForm({
      full_name: selected.full_name,
      email: selected.email,
      password: '',
      role: selected.role,
      must_change_password: Boolean(selected.must_change_password),
      ui_variant: selected.ui_variant || 'pro'
    })
  }

  const handleCancelEdit = () => {
    setEditingUser(null)
    setEditForm({
      full_name: '',
      email: '',
      password: '',
      role: 'user',
      must_change_password: false
    })
  }

  const handleUpdateUser = (event) => {
    event.preventDefault()
    if (!editingUser) return
    setUserBanner(null)
    const payload = {
      full_name: editForm.full_name.trim(),
      email: editForm.email.trim(),
      role: editForm.role,
      must_change_password: Boolean(editForm.must_change_password),
      ui_variant: editForm.ui_variant
    }
    if (editForm.password) {
      if (!STRONG_PASSWORD_PATTERN.test(editForm.password)) {
        setUserBanner({ type: 'error', message: PASSWORD_REQUIREMENTS })
        return
      }
      payload.password = editForm.password
    }
    updateUserMutation.mutate({ id: editingUser.id, payload })
  }

  const handleDeleteUser = (id) => {
    if (id === user?.id) {
      setUserBanner({ type: 'error', message: 'You cannot remove your own account.' })
      return
    }
    const confirmed = typeof window !== 'undefined' ? window.confirm('Remove this user account?') : true
    if (!confirmed) return
    setUserBanner(null)
    deleteUserMutation.mutate(id)
  }

  return (
    <div className="page settings-page">
      <div className="card settings-page__intro">
        <div>
          <h2>Administration hub</h2>
          <p className="muted">Coordinate workspace preferences, manage your organization and keep your data safe.</p>
        </div>
        <div className="settings-page__summary">
          <span className="badge badge--muted">{user?.email || 'Signed-in user'}</span>
          {organization?.timezone && <span className="badge">{organization.timezone}</span>}
        </div>
      </div>

      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {navigationItems.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`settings-tabs__item${activeSection === item.id ? ' settings-tabs__item--active' : ''}`}
            aria-selected={activeSection === item.id}
            aria-controls={`settings-${item.id}`}
            onClick={() => setActiveSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        {!isDeveloper && (
          <section
            id="settings-profile"
            className="settings-section"
            hidden={activeSection !== 'profile'}
            aria-hidden={activeSection !== 'profile'}
          >
            <header className="settings-section__header">
              <h2>Profile & preferences</h2>
              <p className="muted">Keep your personal details and workspace layout up to date.</p>
            </header>
            <div className="settings-section__cards">
              <div className="card settings-card">
                <h3>Account</h3>
                <div className="details-grid">
                  <div>
                    <span className="muted">Name</span>
                    <p>{user?.name || '—'}</p>
                  </div>
                  <div>
                    <span className="muted">Email</span>
                    <p>{user?.email || '—'}</p>
                  </div>
                  <div>
                    <span className="muted">Role</span>
                    <p className="badge badge--muted">{user?.role || 'team member'}</p>
                  </div>
                  <div>
                    <span className="muted">Organization</span>
                    <p>{user?.organization?.name || '—'}</p>
                  </div>
                  <div>
                    <span className="muted">Interface style</span>
                    <p className="badge">{activeVariant.name}</p>
                  </div>
                </div>
              </div>

              <div className="card settings-card">
                <div className="card__header">
                  <div>
                    <h3>Personal preferences</h3>
                    <p className="muted">Tailor the interface to match how you like to work.</p>
                  </div>
                </div>
                {preferencesBanner && (
                  <div className={`banner banner--${preferencesBanner.type === 'error' ? 'danger' : 'info'}`}>
                    {preferencesBanner.message}
                  </div>
                )}
                <form className="variant-form" onSubmit={handleSavePreferences}>
                  <div className="variant-grid">
                    {uiVariants.map((variant) => (
                      <label
                        key={variant.id}
                        className={`variant-option${selectedVariant === variant.id ? ' variant-option--active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="ui-variant"
                          value={variant.id}
                          checked={selectedVariant === variant.id}
                          onChange={() => setSelectedVariant(variant.id)}
                        />
                        <div className="variant-option__body">
                          <div className={`variant-preview variant-preview--${variant.id}`} aria-hidden="true" />
                          <div>
                            <p className="variant-option__title">{variant.name}</p>
                            <p className="variant-option__description muted">{variant.description}</p>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="variant-options__toggles">
                    <label className="field field--checkbox">
                      <input
                        type="checkbox"
                        checked={transitionLoading}
                        onChange={(event) => setTransitionLoading(event.target.checked)}
                      />
                      <span>Show loading animation between page transitions</span>
                    </label>
                    <p className="muted">Disable this if you prefer instant navigation without visual transitions.</p>
                  </div>
                  <div className="form-actions">
                    <button className="button button--primary" type="submit" disabled={preferencesMutation.isLoading}>
                      {preferencesMutation.isLoading ? 'Saving…' : 'Save preferences'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </section>
        )}

        {isDeveloper && (
          <section
            id="settings-readiness"
            className="settings-section"
            hidden={activeSection !== 'readiness'}
            aria-hidden={activeSection !== 'readiness'}
          >
            <header className="settings-section__header">
              <h2>Security & readiness</h2>
              <p className="muted">Tick through deployment essentials before go-live.</p>
            </header>
            <div className="settings-section__cards">
              <div className="card settings-card">
                <h3>Deployment checklist</h3>
                <ul className="checklist checklist--status">
                  {readinessChecks.length === 0 && (
                    <li className="checklist__item">
                      <span className="checklist__status" aria-hidden="true">…</span>
                      <div>
                        <strong>Compiling readiness report</strong>
                        <p className="muted">System checks are running. This list will refresh once metrics are available.</p>
                      </div>
                    </li>
                  )}
                  {readinessChecks.map((check) => (
                    <li
                      key={check.id}
                      className={`checklist__item${check.ok ? ' checklist__item--ok' : ' checklist__item--warn'}`}
                    >
                      <span
                        className={`checklist__status${check.ok ? ' checklist__status--ok' : ' checklist__status--warn'}`}
                        aria-hidden="true"
                      >
                        {check.ok ? '✓' : '!'}
                      </span>
                      <div>
                        <strong>{check.title}</strong>
                        <p className="muted">{check.description}</p>
                        {!check.ok && check.recommendation && (
                          <p className="checklist__recommendation">{check.recommendation}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {readinessSummary && (
                  <dl className="readiness-summary">
                    <div>
                      <dt>Automated backups</dt>
                      <dd>{readinessSummary.backup_enabled ? 'Enabled' : 'Disabled'}</dd>
                    </div>
                    <div>
                      <dt>Last backup</dt>
                      <dd>{readinessSummary.latest_backup ? new Date(readinessSummary.latest_backup).toLocaleString() : 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt>Escalation recipients</dt>
                      <dd>{readinessSummary.notification_recipients || 0}</dd>
                    </div>
                  </dl>
                )}
                {readinessGeneratedAt && (
                  <p className="checklist__generated muted">
                    Report generated {new Date(readinessGeneratedAt).toLocaleString()}.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {(isAdmin || isDeveloper) && (
          <>
          {isDeveloper && (
              <section
                id="settings-organization"
                className="settings-section"
                hidden={activeSection !== 'organization'}
                aria-hidden={activeSection !== 'organization'}
              >
                <header className="settings-section__header">
                  <h2>Organization profile</h2>
                  <p className="muted">Manage branding, legal and invoicing defaults for your {APP_NAME} workspace.</p>
                </header>
                <div className="settings-section__cards">
                  <div className="card settings-card">
                    {orgBanner && (
                      <div className={`banner banner--${orgBanner.type === 'error' ? 'danger' : 'info'}`}>
                        {orgBanner.message}
                      </div>
                    )}
                    <form className="form-grid" onSubmit={handleOrganizationSubmit}>
                      <label className="field" data-help="Display name shown in navigation and dashboards.">
                        <span>Organization name</span>
                        <input
                          value={orgForm.name}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, name: e.target.value }))}
                          required
                        />
                      </label>
                      <label className="field" data-help="Registered legal entity name used on invoices.">
                        <span>Legal name</span>
                        <input
                          value={orgForm.legal_name}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, legal_name: e.target.value }))}
                          placeholder="Registered business name"
                        />
                      </label>
                      <label className="field" data-help="Select the category that best represents your operations.">
                        <span>Organization type</span>
                        <select
                          value={orgForm.type}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, type: e.target.value }))}
                        >
                          <option value="">Select organization type</option>
                          {ORGANIZATION_TYPES.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                        <small className="muted">
                          {selectedOrgType ? selectedOrgType.description : 'Used to tailor copy and insights throughout the app.'}
                        </small>
                      </label>
                      <label className="field" data-help="Primary address for alerts and administrative notifications.">
                        <span>Notification email</span>
                        <input
                          type="email"
                          value={orgForm.contact_email}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, contact_email: e.target.value }))}
                          placeholder="alerts@your-company.com"
                        />
                        <small className="muted">Administrative emails and backup alerts will be delivered here.</small>
                      </label>
                      <label className="field" data-help="Timezone used for due dates and scheduling.">
                        <span>Timezone</span>
                        <input
                          value={orgForm.timezone}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, timezone: e.target.value }))}
                          placeholder="e.g. America/New_York"
                        />
                      </label>
                      <label className="field" data-help="Government-issued business number for compliance.">
                        <span>ABN / business number</span>
                        <input
                          value={orgForm.abn}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, abn: e.target.value }))}
                          placeholder="e.g. 12 345 678 901"
                        />
                      </label>
                      <label className="field" data-help="Tax identifier displayed on quotes and invoices.">
                        <span>Tax registration</span>
                        <input
                          value={orgForm.tax_id}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, tax_id: e.target.value }))}
                          placeholder="VAT, GST or other tax ID"
                        />
                      </label>
                      <label className="field field--span" data-help="Head office or registered trading address.">
                        <span>Registered address</span>
                        <textarea
                          rows={3}
                          value={orgForm.address}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, address: e.target.value }))}
                          placeholder="Street, city, state and postcode"
                        />
                      </label>
                      <label className="field" data-help="Main phone number for customer contact.">
                        <span>Support phone</span>
                        <input
                          value={orgForm.phone}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, phone: e.target.value }))}
                          placeholder="e.g. +61 2 1234 5678"
                        />
                      </label>
                      <label className="field" data-help="Public website or knowledge base link for staff reference.">
                        <span>Website</span>
                        <input
                          value={orgForm.website}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, website: e.target.value }))}
                          placeholder="https://example.com"
                        />
                      </label>
                      <label className="field field--span" data-help="Upload a PNG or JPG logo or provide a hosted link for branding.">
                        <span>Brand logo</span>
                        {logoPreview ? (
                          <div className="logo-preview">
                            <img src={logoPreview} alt="Logo preview" />
                          </div>
                        ) : null}
                        <div className="field__stack">
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            onChange={handleLogoUpload}
                            disabled={uploadLogoMutation.isLoading}
                          />
                          <input
                            value={orgForm.logo_url}
                            onChange={(e) => setOrgForm((prev) => ({ ...prev, logo_url: e.target.value }))}
                            placeholder="Link to hosted logo image"
                          />
                        </div>
                        <small className="muted">
                          {uploadLogoMutation.isLoading
                            ? 'Uploading logo…'
                            : 'PNG or JPG up to 2 MB. Leave blank to use the default system mark.'}
                        </small>
                      </label>
                      <label className="field field--span" data-help="Images displayed on the dashboard banner carousel.">
                        <span>Dashboard banner images</span>
                        {bannerPreview.length > 0 && (
                          <div className="banner-preview-grid">
                            {bannerPreview.map((url, index) => (
                              <img key={`${url}-${index}`} src={url} alt={`Banner ${index + 1}`} />
                            ))}
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={handleBannerUpload}
                          disabled={uploadBannerMutation.isLoading || bannerList.length >= 10}
                        />
                        <textarea
                          rows={3}
                          value={orgForm.banner_images}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, banner_images: e.target.value }))}
                          placeholder={`https://example.com/banner-1.jpg\nhttps://example.com/banner-2.jpg`}
                        />
                        <small className="muted">
                          {uploadBannerMutation.isLoading
                            ? 'Uploading banner…'
                            : bannerList.length >= 10
                              ? 'Maximum of 10 banner images reached. Remove a line to upload another.'
                              : 'Upload PNG or JPG up to 5 MB or paste hosted image URLs. One entry per line, up to 10 images.'}
                        </small>
                      </label>
                      <div className="field field--span">
                        <span>Invoicing visibility</span>
                        <div className="field__stack">
                          <button
                            type="button"
                            className={`button ${orgForm.invoicing_enabled ? 'button--ghost' : 'button--primary'}`}
                            onClick={toggleInvoicing}
                          >
                            {orgForm.invoicing_enabled ? 'Disable invoicing' : 'Enable invoicing'}
                          </button>
                          <small className="muted">
                            {orgForm.invoicing_enabled
                              ? 'Invoices are visible to admins. Disable to hide all invoicing features across the workspace.'
                              : 'Invoices are hidden for everyone. Enable to restore invoicing screens and defaults.'}
                          </small>
                        </div>
                      </div>
                      <label className="field" data-help="Prefix automatically applied to new invoice numbers.">
                        <span>Invoice prefix</span>
                        <input
                          value={orgForm.invoice_prefix}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, invoice_prefix: e.target.value }))}
                          placeholder="e.g. INV- or JOB-"
                          disabled={!orgForm.invoicing_enabled}
                        />
                      </label>
                      <label className="field" data-help="Default credit terms displayed on new invoices.">
                        <span>Default payment terms</span>
                        <input
                          value={orgForm.default_payment_terms}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, default_payment_terms: e.target.value }))}
                          placeholder="e.g. Net 14"
                          disabled={!orgForm.invoicing_enabled}
                        />
                      </label>
                      <label className="field" data-help="Currency code used for pricing and billing.">
                        <span>Default currency</span>
                        <input
                          value={orgForm.currency}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, currency: e.target.value }))}
                          placeholder="e.g. AUD"
                          disabled={!orgForm.invoicing_enabled}
                        />
                      </label>
                      <label className="field field--span" data-help="Standard footer text appended to every invoice.">
                        <span>Default invoice notes</span>
                        <textarea
                          rows={3}
                          value={orgForm.invoice_notes}
                          onChange={(e) => setOrgForm((prev) => ({ ...prev, invoice_notes: e.target.value }))}
                          placeholder="Displayed on all invoices by default"
                          disabled={!orgForm.invoicing_enabled}
                        />
                      </label>
                      <div className="form-actions">
                        <button className="button button--primary" type="submit" disabled={organizationMutation.isLoading}>
                          {organizationMutation.isLoading ? 'Saving…' : 'Save organization'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </section>
            )}

          {isAdmin && (
                <section
                  id="settings-team"
                  className="settings-section"
                  hidden={activeSection !== 'team'}
                  aria-hidden={activeSection !== 'team'}
                >
                <header className="settings-section__header">
                  <h2>User management</h2>
                  <p className="muted">Control who can access the platform and enforce secure practices.</p>
                </header>
                <div className="settings-section__cards">
                  <div className="card settings-card">
                    {userBanner && (
                      <div className={`banner banner--${userBanner.type === 'error' ? 'danger' : 'info'}`}>
                        {userBanner.message}
                      </div>
                    )}
                    <div className="settings-card__user-grid">
                      <form className="form-grid" onSubmit={handleCreateUser}>
                        <h3>Invite a team member</h3>
                        <label className="field" data-help="Name shown to other teammates and on activity logs.">
                          <span>Full name</span>
                          <input
                            value={userForm.full_name}
                            onChange={(e) => setUserForm((prev) => ({ ...prev, full_name: e.target.value }))}
                            required
                          />
                        </label>
                        <label className="field" data-help="Work email address used to sign in and receive notifications.">
                          <span>Email</span>
                          <input
                            type="email"
                            value={userForm.email}
                            onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))}
                            required
                          />
                        </label>
                        <label className="field" data-help={`Initial password the user must change after first login. ${PASSWORD_REQUIREMENTS}`}>
                          <span>Temporary password</span>
                          <input
                            type="password"
                            value={userForm.password}
                            onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))}
                            required
                          />
                          <small className="muted">{PASSWORD_REQUIREMENTS}</small>
                        </label>
                        <label className="field" data-help="Determines administrative permissions for the user. Choose Developer for secure maintenance access.">
                          <span>Role</span>
                          <select
                            value={userForm.role}
                            onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value }))}
                          >
                            <option value="user">User</option>
                            <option value="admin">Administrator</option>
                            <option value="developer">Developer</option>
                          </select>
                        </label>
                        <label className="field" data-help="Preferred interface layout that loads after login.">
                          <span>Interface style</span>
                          <select
                            value={userForm.ui_variant}
                            onChange={(e) => setUserForm((prev) => ({ ...prev, ui_variant: e.target.value }))}
                          >
                            {uiVariants.map((variant) => (
                              <option key={variant.id} value={variant.id}>{variant.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field field--checkbox" data-help="Forces the invited user to set a personal password.">
                          <input
                            type="checkbox"
                            checked={userForm.must_change_password}
                            onChange={(e) => setUserForm((prev) => ({ ...prev, must_change_password: e.target.checked }))}
                          />
                          <span>Require password change on next login</span>
                        </label>
                        <div className="form-actions">
                          <button className="button button--primary" type="submit" disabled={createUserMutation.isLoading}>
                            {createUserMutation.isLoading ? 'Creating…' : 'Create user'}
                          </button>
                        </div>
                      </form>

                      <div className="user-management">
                        <div className="user-management__header">
                          <h3>Active users</h3>
                          <div className="user-management__search">
                            <label className="field">
                              <span>Search users</span>
                              <input
                                value={userSearch}
                                onChange={(e) => setUserSearch(e.target.value)}
                                placeholder="Search by name, email or role"
                              />
                            </label>
                          </div>
                        </div>
                        <TablePagination
                          page={userPage}
                          totalPages={totalUserPages}
                          onPrev={() => setUserPage((page) => Math.max(1, page - 1))}
                          onNext={() => setUserPage((page) => Math.min(totalUserPages, page + 1))}
                          className="table-pagination--inline"
                        />
                        <div className="table-scroll user-management__table">
                          <table className="table table--compact">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Interface</th>
                                <th>Reset required</th>
                                <th>Created</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredUsers.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="muted">
                                    {users.length === 0
                                      ? 'No additional users created yet.'
                                      : 'No users match your search.'}
                                  </td>
                                </tr>
                              ) : (
                                visibleUsers.map((account) => (
                                  <tr key={account.id}>
                                    <td>{account.full_name}</td>
                                    <td>{account.email}</td>
                                    <td>
                              <span className={`badge badge--${['admin', 'developer'].includes(account.role) ? 'info' : 'muted'}`}>
                                {account.role}
                              </span>
                                    </td>
                                    <td>
                                      <div>
                                        <span className={`badge badge--${account.online ? 'success' : 'muted'}`}>
                                          {account.online ? 'Online now' : 'Offline'}
                                        </span>
                                      </div>
                                      {!account.online && (
                                        <div className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                                          Last seen {account.last_seen_at
                                            ? new Date(account.last_seen_at).toLocaleString()
                                            : 'never'}
                                        </div>
                                      )}
                                    </td>
                                    <td>{(uiVariants.find((variant) => variant.id === account.ui_variant)?.name) || 'Professional'}</td>
                                    <td>{account.must_change_password ? 'Yes' : 'No'}</td>
                                    <td>{account.created_at ? new Date(account.created_at).toLocaleDateString() : '—'}</td>
                                    <td className="table__actions">
                                      <button
                                        type="button"
                                        className="button button--ghost button--small"
                                        onClick={() => handleStartEdit(account)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="button button--ghost button--small"
                                        onClick={() => handleDeleteUser(account.id)}
                                        disabled={deleteUserMutation.isLoading}
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                        <TablePagination
                          page={userPage}
                          totalPages={totalUserPages}
                          onPrev={() => setUserPage((page) => Math.max(1, page - 1))}
                          onNext={() => setUserPage((page) => Math.min(totalUserPages, page + 1))}
                        />

                        {editingUser && (
                          <form className="form-grid form-grid--inline" onSubmit={handleUpdateUser}>
                            <h4>Edit {editingUser.full_name}</h4>
                            <label className="field" data-help="Update the name that appears in user menus and logs.">
                              <span>Full name</span>
                              <input
                                value={editForm.full_name}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, full_name: e.target.value }))}
                                required
                              />
                            </label>
                            <label className="field" data-help="Change the email address used to sign in.">
                              <span>Email</span>
                              <input
                                type="email"
                                value={editForm.email}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                                required
                              />
                            </label>
                            <label className="field" data-help="Adjust the user's access level. Developer includes secure maintenance tools.">
                              <span>Role</span>
                              <select
                                value={editForm.role}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value }))}
                              >
                                <option value="user">User</option>
                                <option value="admin">Administrator</option>
                                <option value="developer">Developer</option>
                              </select>
                            </label>
                            <label className="field" data-help="Select the workspace layout this user will see by default.">
                              <span>Interface style</span>
                              <select
                                value={editForm.ui_variant}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, ui_variant: e.target.value }))}
                              >
                                {uiVariants.map((variant) => (
                                  <option key={variant.id} value={variant.id}>{variant.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="field" data-help={`Optional reset to immediately change the account password. ${PASSWORD_REQUIREMENTS}`}>
                              <span>New password</span>
                              <input
                                type="password"
                                value={editForm.password}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                                placeholder="Leave blank to keep current password"
                              />
                              <small className="muted">{PASSWORD_REQUIREMENTS}</small>
                            </label>
                            <label className="field field--checkbox" data-help="Prompt the user to pick a new password after this update.">
                              <input
                                type="checkbox"
                                checked={editForm.must_change_password}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, must_change_password: e.target.checked }))}
                              />
                              <span>Require password change on next login</span>
                            </label>
                            <div className="form-actions">
                              <button className="button button--primary" type="submit" disabled={updateUserMutation.isLoading}>
                                {updateUserMutation.isLoading ? 'Saving…' : 'Save user'}
                              </button>
                              <button className="button button--ghost button--small" type="button" onClick={handleCancelEdit}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                </section>
              )}

          {isDeveloper && (
              <section
                id="settings-operations"
                className="settings-section"
                hidden={activeSection !== 'operations'}
                aria-hidden={activeSection !== 'operations'}
              >
                <header className="settings-section__header">
                  <h2>Operations & alerts</h2>
                  <p className="muted">Tune SLA targets, notifications and automation.</p>
                </header>
                <div className="settings-section__cards">
                  <div className="card settings-card">
                    {banner && <div className="banner banner--info">{banner}</div>}
                    <form className="form-grid" onSubmit={handleSubmit}>
                      <label className="field" data-help="Control access to the service queue and repair tracking workspace.">
                        <span>Work orders workspace</span>
                        <select
                          value={formState.work_orders_enabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            work_orders_enabled: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Toggle the ability to create and manage customer sales orders.">
                        <span>Sales workspace</span>
                        <select
                          value={formState.sales_module_enabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            sales_module_enabled: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Show or hide the operations overview page for this organization.">
                        <span>Operations overview</span>
                        <select
                          value={formState.operations_module_enabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            operations_module_enabled: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Allow staff to use the in-app camera scanner.">
                        <span>Barcode scanning</span>
                        <select
                          value={formState.barcode_scanning_enabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            barcode_scanning_enabled: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Toggle proactive notifications when products fall below reorder points.">
                        <span>Low stock alerts</span>
                        <select
                          value={formState.low_stock_alerts_enabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            low_stock_alerts_enabled: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Target response time applied to new work orders.">
                        <span>Default SLA window (hours)</span>
                        <input
                          type="number"
                          min="0"
                          value={formState.default_sla_hours}
                          onChange={(e) => setFormState((prev) => ({ ...prev, default_sla_hours: e.target.value }))}
                        />
                      </label>
                      <label className="field" data-help="Automatically assign sequential SKUs to newly created products.">
                        <span>Automatic product SKU</span>
                        <select
                          value={formState.auto_product_sku ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            auto_product_sku: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Generate customer IDs automatically when a new record is created.">
                        <span>Automatic customer ID</span>
                        <select
                          value={formState.auto_customer_id ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            auto_customer_id: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Reserve sequential IDs for new storage locations and warehouses.">
                        <span>Automatic warehouse ID</span>
                        <select
                          value={formState.auto_warehouse_id ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            auto_warehouse_id: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field field--span" data-help="People alerted when escalations or SLA breaches occur.">
                        <span>Escalation emails</span>
                        <textarea
                          rows={2}
                          value={formState.notification_emails}
                          onChange={(e) => setFormState((prev) => ({ ...prev, notification_emails: e.target.value }))}
                          placeholder="ops@example.com, lead@example.com"
                        />
                      </label>
                      <label className="field" data-help="Send a daily digest summarising work orders and stock levels.">
                        <span>Daily digest</span>
                        <select
                          value={formState.daily_digest_enabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            daily_digest_enabled: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Time the daily digest email should be delivered.">
                        <span>Digest delivery time</span>
                        <input
                          type="time"
                          value={formState.daily_digest_time}
                          onChange={(e) => setFormState((prev) => ({ ...prev, daily_digest_time: e.target.value }))}
                        />
                      </label>
                      <label className="field" data-help="Control whether automatic database backups are scheduled.">
                        <span>Backups</span>
                        <select
                          value={formState.backup_enabled ? 'enabled' : 'disabled'}
                          onChange={(e) => setFormState((prev) => ({
                            ...prev,
                            backup_enabled: e.target.value === 'enabled'
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label className="field" data-help="Cron expression describing when backups should run.">
                        <span>Backup schedule (cron)</span>
                        <input
                          type="text"
                          value={formState.backup_schedule}
                          onChange={(e) => setFormState((prev) => ({ ...prev, backup_schedule: e.target.value }))}
                          placeholder="0 3 * * *"
                          required={formState.backup_enabled}
                        />
                        <p className="muted">Use cron syntax to control when automatic backups run.</p>
                      </label>
                      <label className="field" data-help="How long backups are kept before automatic cleanup.">
                        <span>Retention window (days)</span>
                        <input
                          type="number"
                          min="0"
                          value={formState.backup_retain_days}
                          onChange={(e) => setFormState((prev) => ({ ...prev, backup_retain_days: e.target.value }))}
                        />
                        <p className="muted">Older backups beyond this window are pruned automatically.</p>
                      </label>
                      <div className="form-actions">
                        <button className="button" type="submit" disabled={settingsMutation.isLoading}>
                          {settingsMutation.isLoading ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </section>
            )}

          {!isDeveloper && (
                <section
                  id="settings-records"
                  className="settings-section"
                  hidden={activeSection !== 'records'}
                  aria-hidden={activeSection !== 'records'}
                >
                <header className="settings-section__header">
                  <h2>Audit & backups</h2>
                  <p className="muted">Track administrator activity and safeguard your data.</p>
                </header>
                <div className="settings-section__cards settings-section__cards--columns">
                  <div className="card settings-card">
                    <div className="card__header">
                      <div>
                        <h3>User activity</h3>
                        <p className="muted">Audit trail of key actions taken by product administrators.</p>
                      </div>
                    </div>
                    <TablePagination
                      page={activityPage}
                      totalPages={totalActivityPages}
                      onPrev={() => setActivityPage((page) => Math.max(1, page - 1))}
                      onNext={() => setActivityPage((page) => Math.min(totalActivityPages, page + 1))}
                      className="table-pagination--inline"
                    />
                    <div className="table-scroll">
                      <table className="table table--compact">
                        <thead>
                          <tr>
                            <th>Activity</th>
                            <th>User</th>
                            <th>When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activities.length === 0 && (
                            <tr>
                              <td colSpan={3} className="muted">No activity recorded yet.</td>
                            </tr>
                          )}
                          {visibleActivities.map((entry) => (
                            <tr key={entry.id}>
                              <td>
                                <strong>{entry.action}</strong>
                                {entry.description && <p className="muted">{entry.description}</p>}
                              </td>
                              <td>{entry.user ? `${entry.user.name || entry.user.email}` : 'System'}</td>
                              <td>{entry.performed_at ? new Date(entry.performed_at).toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <TablePagination
                      page={activityPage}
                      totalPages={totalActivityPages}
                      onPrev={() => setActivityPage((page) => Math.max(1, page - 1))}
                      onNext={() => setActivityPage((page) => Math.min(totalActivityPages, page + 1))}
                    />
                  </div>

                  <div className="card settings-card">
                    <div className="card__header">
                      <div>
                        <h3>Database backups</h3>
                        <p className="muted">Review automated snapshots and trigger an on-demand backup if required.</p>
                      </div>
                      <button
                        className="button button--primary"
                        type="button"
                        onClick={() => runBackupMutation.mutate()}
                        disabled={runBackupMutation.isLoading}
                      >
                        {runBackupMutation.isLoading ? 'Starting…' : 'Run backup now'}
                      </button>
                    </div>
                    <TablePagination
                      page={backupPage}
                      totalPages={totalBackupPages}
                      onPrev={() => setBackupPage((page) => Math.max(1, page - 1))}
                      onNext={() => setBackupPage((page) => Math.min(totalBackupPages, page + 1))}
                      className="table-pagination--inline"
                    />
                    <div className="table-scroll">
                      <table className="table table--compact">
                        <thead>
                          <tr>
                            <th>File</th>
                            <th>Created</th>
                            <th>Size</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {backups.length === 0 && (
                            <tr>
                              <td colSpan={4} className="muted">No backups generated yet.</td>
                            </tr>
                          )}
                          {visibleBackups.map((backup) => (
                            <tr key={backup.file}>
                              <td>{backup.file}</td>
                              <td>{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : '—'}</td>
                              <td>{(backup.size / 1024 / 1024).toFixed(2)} MB</td>
                              <td>
                                <a
                                  className="button button--ghost button--small"
                                  href={`${api.defaults.baseURL}/backups/${backup.file}?token=${getAccessToken()}`}
                                >
                                  Download
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <TablePagination
                      page={backupPage}
                      totalPages={totalBackupPages}
                      onPrev={() => setBackupPage((page) => Math.max(1, page - 1))}
                      onNext={() => setBackupPage((page) => Math.min(totalBackupPages, page + 1))}
                    />
                  </div>
                </div>
                </section>
              )}

              {isDeveloper && (
                <section
                  id="settings-developer"
                  className="settings-section"
                  hidden={activeSection !== 'developer'}
                  aria-hidden={activeSection !== 'developer'}
                >
                  <header className="settings-section__header">
                    <h2>Developer tools</h2>
                    <p className="muted">Seed sample data and access maintenance utilities.</p>
                  </header>
                  <div className="settings-section__cards">
                    <div className="card settings-card">
                      {developerBanner && (
                        <div className={`banner banner--${developerBanner.type === 'error' ? 'danger' : 'info'}`}>
                          {developerBanner.message}
                        </div>
                      )}
                      <form className="form-grid" onSubmit={handleSeedSubmit}>
                        <label className="field" data-help="Primary developer credential sent as X-Developer-Key.">
                          <span>Developer key</span>
                          <input
                            value={developerKey}
                            onChange={(e) => setDeveloperKey(e.target.value)}
                            placeholder="e.g. dev-xxxxxxxx"
                            autoComplete="off"
                          />
                        </label>
                        <label className="field" data-help="Second-factor code sent as X-Developer-Otp for privileged actions.">
                          <span>One-time passcode</span>
                          <input
                            value={developerOtp}
                            onChange={(e) => setDeveloperOtp(e.target.value)}
                            placeholder="e.g. 123456"
                            autoComplete="off"
                          />
                        </label>
                        <label
                          className="field field--span"
                          data-help="Upload a JSON file describing products, locations, bins and starting stock levels."
                        >
                          <span>Seed file</span>
                          <input
                            ref={seedInputRef}
                            type="file"
                            accept="application/json"
                            onChange={handleSeedFileChange}
                          />
                          {seedFileName && (
                            <small className="muted">
                              Loaded {seedFileName}
                              {seedPreview && (
                                <>
                                  {' '}
                                  · {seedPreview.products} products, {seedPreview.locations} locations, {seedPreview.bins} bins, {seedPreview.stock}
                                  {' '}stock rows
                                </>
                              )}
                            </small>
                          )}
                        </label>
                        <div className="form-actions">
                          <button
                            className="button button--ghost"
                            type="button"
                            onClick={handleSeedDownload}
                            disabled={developerSeedMutation.isLoading}
                          >
                            Download sample JSON
                          </button>
                          <button
                            className="button button--ghost"
                            type="button"
                            onClick={handleSeedClear}
                            disabled={developerSeedMutation.isLoading || !seedPayload}
                          >
                            Clear selection
                          </button>
                          <button
                            className="button button--primary"
                            type="submit"
                            disabled={developerSeedMutation.isLoading}
                          >
                            {developerSeedMutation.isLoading ? 'Seeding…' : 'Seed database'}
                          </button>
                        </div>
                      </form>
                      <div className="developer-tools__actions">
                        <div className="developer-tools__action">
                          <h3>Maintenance console</h3>
                          <p className="muted">Launch an ephemeral shell session secured by multi-factor credentials.</p>
                          <div className="developer-tools__buttons">
                            <button
                              className="button button--primary"
                              type="button"
                              onClick={handleLaunchTerminal}
                              disabled={launchTerminalMutation.isLoading}
                            >
                              {launchTerminalMutation.isLoading ? 'Starting…' : 'Launch web terminal'}
                            </button>
                          </div>
                          {terminalSession && (
                            <>
                              <p className="muted developer-tools__session-meta">
                                Session expires in approximately {Math.max(1, Math.round((terminalSession.expires_in || 0) / 60))} minutes.
                              </p>
                              <DeveloperTerminal session={terminalSession} onClose={handleCloseTerminal} />
                            </>
                          )}
                        </div>
                        <div className="developer-tools__action">
                          <h3>Data export</h3>
                          <p className="muted">Download the latest workspace data as structured JSON for offline analysis.</p>
                          <button
                            className="button button--ghost"
                            type="button"
                            onClick={handleExportDatabase}
                            disabled={exportDatabaseMutation.isLoading}
                          >
                            {exportDatabaseMutation.isLoading ? 'Preparing…' : 'Download export JSON'}
                          </button>
                        </div>
                      </div>
                      {seedResult?.summary && (
                        <div className="seed-summary">
                          <h4>Last seed summary</h4>
                          <ul>
                            <li>
                              Products: {seedResult.summary.products?.created ?? 0} created,{' '}
                              {seedResult.summary.products?.updated ?? 0} updated
                            </li>
                            <li>
                              Locations: {seedResult.summary.locations?.created ?? 0} created,{' '}
                              {seedResult.summary.locations?.updated ?? 0} updated
                            </li>
                            <li>
                              Bins: {seedResult.summary.bins?.created ?? 0} created,{' '}
                              {seedResult.summary.bins?.updated ?? 0} updated
                            </li>
                            <li>
                              Stock rows: {seedResult.summary.stock?.created ?? 0} created,{' '}
                              {seedResult.summary.stock?.updated ?? 0} updated
                            </li>
                          </ul>
                          {seedResult.seeded_at && (
                            <p className="muted">Completed {new Date(seedResult.seeded_at).toLocaleString()}</p>
                          )}
                        </div>
                      )}
                      <details className="seed-sample">
                        <summary>View sample JSON structure</summary>
                        <pre><code>{SAMPLE_SEED_TEMPLATE}</code></pre>
                      </details>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
    </div>
  )
}

