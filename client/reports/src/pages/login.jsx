import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Mail, Lock, AlertCircle, Loader } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [userInfo, setUserInfo] = useState(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleSubmit = async () => {
    setError('');

    // Validation
    if (!formData.email || !formData.password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);

    try {
      const API_BASE = 'http://localhost:5000';
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Login failed');
      }

      // Store token in localStorage
      if (data.token) {
        localStorage.setItem('token', data.token);
      }

      // Extract user role from the response
      const userRole = data.user?.role || 'client';

      // Generate full name from email if not provided
      const emailUsername = formData.email.split('@')[0];
      const fullName = data.user?.name || 
                      data.user?.full_name || 
                      data.name || 
                      data.full_name ||
                      `${data.user?.firstName || data.firstName || ''} ${data.user?.lastName || data.lastName || ''}`.trim() ||
                      emailUsername.split('.').map(part => 
                        part.charAt(0).toUpperCase() + part.slice(1)
                      ).join(' ') ||
                      'User';

      // Build user data object
      const userData = {
        email: data.user?.email || formData.email,
        fullName: fullName,
        companyName: data.user?.companyName || 'N/A',
        role: userRole,
        userId: data.user?.id || data.user?.userId,
        accountNumber: data.user?.accountNumber || null,
        status: data.user?.status || 'active',
        token: data.token
      };

      // Store user data
      localStorage.setItem('user', JSON.stringify(userData));

      console.log('✅ Login successful:', {
        email: userData.email,
        fullName: userData.fullName,
        role: userData.role,
        company: userData.companyName,
        accountNumber: userData.accountNumber,
        status: userData.status
      });

      // Notify app components that storage has changed
      window.dispatchEvent(new Event('storage'));

      setLoginSuccess(true);
      setUserInfo(userData);

      // Navigate based on role - IMMEDIATELY without setTimeout
      if (userRole === 'admin') {
        navigate('/admin', { replace: true });
      } else {
        navigate('/client-dashboard', { replace: true });
      }

    } catch (err) {
      setError(err.message || 'Failed to login');
      console.error('❌ Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8">
        
        {/* Left Side - Login Form */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 lg:p-12">
          
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
            <p className="text-gray-600">Sign in to access your security dashboard</p>
          </div>

          {/* Login Form */}
          <div className="space-y-6">
            
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {loginSuccess && userInfo && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5">✓</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-green-800 mb-1">Login successful! Redirecting...</p>
                    <div className="text-xs text-green-700 space-y-1">
                      <p>Email: {userInfo.email}</p>
                      <p>Role: {userInfo.role}</p>
                      <p>Company: {userInfo.companyName}</p>
                      {userInfo.accountNumber && (
                        <p>Account: {userInfo.accountNumber}</p>
                      )}
                      <p>Status: {userInfo.status}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Email Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  onKeyPress={handleKeyPress}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  placeholder="you@company.com"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  onKeyPress={handleKeyPress}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  disabled={loading}
                />
                <span className="ml-2 text-sm text-gray-600">Remember me</span>
              </label>
              <button 
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </div>

          {/* Signup Link */}
          <p className="text-center mt-6 text-sm text-gray-600">
            Don't have an account?{' '}
            <button 
              className="text-blue-600 hover:text-blue-700 font-medium"
              onClick={() => navigate('/signup')}
            >
              Sign up
            </button>
          </p>
        </div>

        {/* Right Side - Info Panel */}
        <div className="hidden lg:flex flex-col justify-center text-white space-y-8">
          
          {/* Divider */}
          <div className="border-b border-white/20 pb-8">
            <h2 className="text-2xl font-bold mb-2">Security Dashboard Access</h2>
            <p className="text-blue-200">Real-time monitoring and analytics for your security operations</p>
          </div>

          {/* Features List */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm">✓</span>
              </div>
              <div>
                <h3 className="font-semibold mb-1">Real-time patrol monitoring</h3>
                <p className="text-sm text-blue-200">Track security personnel location and activities</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm">✓</span>
              </div>
              <div>
                <h3 className="font-semibold mb-1">Automated report generation</h3>
                <p className="text-sm text-blue-200">AI-powered summaries and insights</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm">✓</span>
              </div>
              <div>
                <h3 className="font-semibold mb-1">24/7 security insights</h3>
                <p className="text-sm text-blue-200">Comprehensive analytics and performance metrics</p>
              </div>
            </div>
          </div>

          {/* Demo Info */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <h3 className="font-semibold mb-3 text-lg">🔐 Role-Based Access:</h3>
            <div className="space-y-2 text-sm">
              <p><strong>Admin</strong> - Security analytics, reports & client management</p>
              <p className="text-xs text-blue-200">→ Redirects to /admin</p>
              <p className="mt-2"><strong>Client</strong> - VigiControl arrivals & performance dashboard</p>
              <p className="text-xs text-blue-200">→ Redirects to /client-dashboard</p>
            </div>
            <div className="mt-4 pt-4 border-t border-white/20 text-xs text-blue-200 space-y-1">
              <p><strong>API Endpoint:</strong> http://localhost:5000/api/auth/login</p>
              <p><strong>Method:</strong> POST</p>
              <p><strong>Body:</strong> {`{ email, password }`}</p>
            </div>
          </div>

          {/* API Response Info */}
          <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10 text-xs">
            <p className="font-semibold mb-2 text-blue-300">📦 Expected Response:</p>
            <pre className="text-blue-100 overflow-x-auto">
{`{
  success: true,
  token: "jwt_token",
  user: {
    email: "user@example.com",
    role: "client" | "admin",
    companyName: "Company",
    accountNumber: "12345",
    status: "active"
  }
}`}
            </pre>
          </div>

          {/* Footer */}
          <div className="text-center text-sm text-blue-200 pt-8 border-t border-white/20">
            Protected by BM Security • Trusted by businesses across Kenya
          </div>
        </div>
      </div>
    </div>
  );
}