import { useState } from 'react';
import { Shield, Mail, Lock, Building, AlertCircle, CheckCircle, Loader } from 'lucide-react';

export default function Signup() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    companyName: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [signupData, setSignupData] = useState(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');

    // Validation
    if (!formData.email || !formData.password || !formData.companyName) {
      setError('Email, password, and company name are required');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const API_BASE = 'http://localhost:5000';
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          companyName: formData.companyName
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Signup failed');
      }

      // Store token in localStorage
      if (data.token) {
        localStorage.setItem('authToken', data.token);
      }

      // Extract user role
      const userRole = data.user?.role || 'client';

      // Build user data object
      const userData = {
        email: data.user?.email || formData.email,
        companyName: data.user?.companyName || formData.companyName,
        role: userRole,
        userId: data.user?.id || data.user?.userId,
        accountNumber: data.user?.accountNumber || null,
        status: data.user?.status || 'pending_link',
        token: data.token
      };

      // Store user data
      localStorage.setItem('user', JSON.stringify(userData));

      console.log('✅ Signup successful:', {
        email: userData.email,
        role: userData.role,
        company: userData.companyName,
        accountNumber: userData.accountNumber,
        status: userData.status,
        autoLinked: data.autoLinked,
        confidence: data.confidence,
        discoveryMethod: data.discoveryMethod
      });

      setSignupData({
        ...userData,
        autoLinked: data.autoLinked,
        confidence: data.confidence,
        discoveryMethod: data.discoveryMethod,
        pendingMessage: data.pendingMessage
      });

      // Show success message based on account linking status
      if (data.autoLinked) {
        setSuccess(`Account created and linked successfully! (${data.confidence} confidence via ${data.discoveryMethod})`);
      } else {
        setSuccess(data.pendingMessage || 'Account created! Setting up your dashboard...');
      }

      // Simulate navigation after 2 seconds
      setTimeout(() => {
        if (userRole === 'admin') {
          console.log('🔄 Redirecting to: /admin');
          alert('Account created!\n\nRole: Admin\nRedirecting to: /admin');
        } else {
          console.log('🔄 Redirecting to: /client-dashboard');
          alert('Account created!\n\nRole: Client\nRedirecting to: /client-dashboard');
        }
      }, 2000);

    } catch (err) {
      setError(err.message || 'Failed to create account');
      console.error('❌ Signup error:', err);
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
      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-8">
        
        {/* Left Side - Signup Form */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 lg:p-10">
          
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Account</h1>
            <p className="text-gray-600">Join BM Security Guard Reporting System</p>
          </div>

          {/* Signup Form */}
          <div className="space-y-5">
            
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-start gap-3 mb-2">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-green-800 mb-1">{success}</p>
                    {signupData && (
                      <div className="text-xs text-green-700 space-y-1 mt-2">
                        <p>Email: {signupData.email}</p>
                        <p>Company: {signupData.companyName}</p>
                        <p>Status: {signupData.status}</p>
                        {signupData.accountNumber && (
                          <p>Account: {signupData.accountNumber}</p>
                        )}
                        {signupData.autoLinked && (
                          <p className="text-green-600 font-semibold mt-2">
                            ✓ Auto-linked via {signupData.discoveryMethod}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Email Input */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  id="email"
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

            {/* Company Name Input */}
            <div>
              <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-2">
                Company Name
              </label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  id="companyName"
                  name="companyName"
                  value={formData.companyName}
                  onChange={handleChange}
                  onKeyPress={handleKeyPress}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  placeholder="Your Company Name"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  onKeyPress={handleKeyPress}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters</p>
            </div>

            {/* Confirm Password Input */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  onKeyPress={handleKeyPress}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>
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
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </div>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <button 
                className="text-blue-600 hover:text-blue-700 font-medium"
                onClick={() => alert('Navigate to: /login')}
              >
                Sign in
              </button>
            </p>
          </div>
        </div>

        {/* Right Side - Info Panel */}
        <div className="hidden lg:flex flex-col justify-center text-white space-y-6">
          
          {/* Header */}
          <div className="border-b border-white/20 pb-6">
            <h2 className="text-2xl font-bold mb-2">Intelligent Account Linking</h2>
            <p className="text-blue-200">Our system automatically discovers and links your security account</p>
          </div>

          {/* How It Works */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold mb-1">Create Your Account</h3>
                <p className="text-sm text-blue-200">Enter your email, company name, and password</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold mb-1">Automatic Discovery</h3>
                <p className="text-sm text-blue-200">We search our database for your security account using AI-powered matching</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold mb-1">Instant Access</h3>
                <p className="text-sm text-blue-200">If we find a high-confidence match, you're ready to go immediately</p>
              </div>
            </div>
          </div>

          {/* Confidence Levels */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <h3 className="font-semibold mb-3 text-lg">🎯 Confidence Levels:</h3>
            <div className="space-y-2 text-sm">
              <p>✅ <strong>Very High/High</strong> - Auto-linked instantly</p>
              <p>⚠️ <strong>Medium/Low</strong> - Manual review required</p>
              <p>❌ <strong>No Match</strong> - Contact support for setup</p>
            </div>
          </div>

          {/* API Info */}
          <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10 text-xs">
            <p className="font-semibold mb-2 text-blue-300">📦 API Endpoint:</p>
            <p className="text-blue-100 mb-2">POST http://localhost:5000/api/auth/signup</p>
            <pre className="text-blue-100 overflow-x-auto">
{`{
  email: "user@company.com",
  password: "secure123",
  companyName: "Company Ltd"
}`}
            </pre>
          </div>

          {/* Footer */}
          <div className="text-center text-sm text-blue-200 pt-6 border-t border-white/20">
            Protected by BM Security • Trusted by businesses across Kenya
          </div>
        </div>
      </div>
    </div>
  );
}